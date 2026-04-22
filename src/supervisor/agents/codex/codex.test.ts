import { describe, expect, it } from "vitest";
import {
  createCodexAdapter,
  deriveCodexStructuredState,
  detectCodexReadyForInitialPrompt,
  detectCodexTerminalStatus,
  detectCodexUpdatePrompt,
  parseCodexSocketMessage,
} from "./index";
import type { OscNotification } from "@/shared/osc";
import { codexIntentFor } from "./plugin/intentMap";
import { mapCodexModels } from "./probe";

describe("deriveCodexStructuredState", () => {
  it("maps active approval state to needs_approval", () => {
    expect(
      deriveCodexStructuredState({
        type: "active",
        activeFlags: ["waitingOnApproval"],
      }),
    ).toEqual({
      status: "needs_approval",
      attention: "needs_approval",
    });
  });

  it("maps active user input state to needs_reply", () => {
    expect(
      deriveCodexStructuredState({
        type: "active",
        activeFlags: ["waitingOnUserInput"],
      }),
    ).toEqual({
      status: "needs_reply",
      attention: "needs_reply",
    });
  });

  it("maps active work with no flags to working", () => {
    expect(
      deriveCodexStructuredState({
        type: "active",
        activeFlags: [],
      }),
    ).toEqual({
      status: "working",
      attention: "working",
    });
  });

  it("maps idle state to idle", () => {
    expect(deriveCodexStructuredState({ type: "idle" })).toEqual({
      status: "idle",
      attention: "none",
    });
  });

  it("maps system errors to error", () => {
    expect(deriveCodexStructuredState({ type: "systemError" })).toEqual({
      status: "error",
      attention: "error",
    });
  });

  it("treats method messages with ids as server requests, not client responses", () => {
    expect(
      parseCodexSocketMessage({
        jsonrpc: "2.0",
        id: "req-1",
        method: "item/tool/requestUserInput",
        params: {
          questions: [],
        },
      }),
    ).toEqual({
      kind: "request",
      id: "req-1",
      method: "item/tool/requestUserInput",
      params: {
        questions: [],
      },
    });
  });

  it("treats id-only messages as JSON-RPC responses", () => {
    expect(
      parseCodexSocketMessage({
        jsonrpc: "2.0",
        id: "lightcode-1",
        result: {
          ok: true,
        },
      }),
    ).toEqual({
      kind: "response",
      id: "lightcode-1",
      result: {
        ok: true,
      },
    });
  });
});

describe("detectCodexUpdatePrompt", () => {
  const SAMPLE_TEXT = [
    "🎉Update available! 0.116.0 -> 0.117.0",
    "",
    "Release notes: https://github.com/openai/codex/releases/latest",
    "",
    "> 1. Update now (runs `npm install -g @openai/codex`)",
    "  2. Skip",
    "  3. Skip until next version",
    "",
    "Press enter to continue",
  ].join("\n");

  it("detects the update prompt", () => {
    expect(detectCodexUpdatePrompt(SAMPLE_TEXT)).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(detectCodexUpdatePrompt("hello world")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(detectCodexUpdatePrompt("")).toBe(false);
  });

  it("detects without emoji prefix", () => {
    expect(detectCodexUpdatePrompt("Update available! 0.116.0 -> 0.117.0")).toBe(true);
  });
});

describe("detectCodexReadyForInitialPrompt", () => {
  it("returns true for the normal Codex home screen", () => {
    const text = [
      "OpenAI Codex (v0.116.0)",
      "model: gpt-5.4-mini high /model to change",
      "directory: ~/work/site-search-ui",
    ].join("\n");

    expect(detectCodexReadyForInitialPrompt(text)).toBe(true);
  });

  it("returns false while the update prompt is visible", () => {
    const text = [
      "Update available! 0.116.0 -> 0.117.0",
      "OpenAI Codex (v0.116.0)",
      "directory: ~/work/site-search-ui",
      "model: gpt-5.4-mini high /model to change",
    ].join("\n");

    expect(detectCodexReadyForInitialPrompt(text)).toBe(false);
  });
});

describe("detectCodexTerminalStatus", () => {
  it("returns working for the Codex 0.122+ `esc to interrupt` marker", () => {
    expect(detectCodexTerminalStatus("⠸ Working (5s  esc to interrupt)")).toEqual({
      status: "working",
      attention: "working",
      corroborated: false,
    });
  });

  it("returns working for the `Working (Ns` timer when esc text is in a later chunk", () => {
    // Same TUI line as 0.122+, but PTY can split before `esc to interrupt` arrives.
    expect(detectCodexTerminalStatus("⠴ Working (0s")).toEqual({
      status: "working",
      attention: "working",
      corroborated: false,
    });
  });

  it("returns working for the legacy `Esc to cancel` marker", () => {
    expect(detectCodexTerminalStatus("⊙ Thinking (Esc to cancel)")).toEqual({
      status: "working",
      attention: "working",
      corroborated: false,
    });
  });

  it("returns working for thinking / reasoning / planning style lines (historical TUI parse)", () => {
    expect(detectCodexTerminalStatus("\n  Reasoning…")).toEqual({
      status: "working",
      attention: "working",
      corroborated: false,
    });
    expect(detectCodexTerminalStatus("\n⊙ Thinking about it")).toEqual({
      status: "working",
      attention: "working",
      corroborated: false,
    });
  });

  it("returns null on the home / idle bar", () => {
    const home = [
      "OpenAI Codex (v0.116.0)",
      "model: gpt-5.4-mini high /model to change",
      "directory: ~/work/site-search-ui",
    ].join("\n");
    expect(detectCodexTerminalStatus(home)).toBeNull();
  });

  it("returns null while the update prompt is visible", () => {
    expect(detectCodexTerminalStatus("Update available! 0.116.0 -> 0.117.0")).toBeNull();
  });

  it("returns null for prose with `working on` (not the status line)", () => {
    expect(
      detectCodexTerminalStatus("I am working on the refactor. Working on it now."),
    ).toBeNull();
  });

  it("returns null when working markers are only in scrollback, not in the recent tail", () => {
    // Full-frame PTY strings keep finished-turn lines above the live footer; the
    // last ~2k chars should be idle-only, so we must not match earlier "Working" rows.
    const oldStatus = "⠸ Working (0s  esc to interrupt)";
    const idleBottom = "gpt-5.4 low · ~\\work · master · Context 2% used · 5h 90%";
    const padding = "a".repeat(5000);
    expect(detectCodexTerminalStatus(`${oldStatus}\n${padding}${idleBottom}`)).toBeNull();
  });

  it("returns null when the matched Working line is verbatim in the idle snapshot", () => {
    // Codex bakes a static `● Working (Xs • esc to interrupt)` line into
    // scrollback on turn completion; subsequent TUI repaints re-emit it and
    // would otherwise re-flip the thread to `working` forever.
    const stale = "● Working (1s • esc to interrupt)";
    expect(
      detectCodexTerminalStatus(`some repaint\n${stale}\nbottom bar`, {
        idleStrippedTail: `prior turn output\n${stale}\n`,
      }),
    ).toBeNull();
  });

  it("still returns working for a fresh Working line not in the idle snapshot", () => {
    const stale = "● Working (5s • esc to interrupt)";
    const fresh = "⠸ Working (0s • esc to interrupt)";
    expect(
      detectCodexTerminalStatus(`prev turn\n${stale}\nlive status: ${fresh}`, {
        idleStrippedTail: `prior turn output\n${stale}\n`,
      }),
    ).toEqual({ status: "working", attention: "working", corroborated: false });
  });

  it("ignores the idle snapshot when it is empty or undefined", () => {
    const live = "⠸ Working (0s • esc to interrupt)";
    expect(detectCodexTerminalStatus(live, { idleStrippedTail: "" })).toEqual({
      status: "working",
      attention: "working",
      corroborated: false,
    });
    expect(detectCodexTerminalStatus(live, {})).toEqual({
      status: "working",
      attention: "working",
      corroborated: false,
    });
  });
});

function osc(body: string, title = ""): OscNotification {
  return { code: 9, title, body, payload: undefined };
}

describe("createCodexAdapter handleOscNotification", () => {
  const adapter = createCodexAdapter();

  it("maps approval notifications to needs_approval", () => {
    expect(adapter.handleOscNotification?.(osc("approval-requested"))).toEqual({
      status: "needs_approval",
      attention: "needs_approval",
      corroborated: true,
    });
  });

  it("maps agent-turn-complete to idle", () => {
    expect(adapter.handleOscNotification?.(osc("agent-turn-complete"))).toEqual({
      status: "idle",
      attention: "none",
      corroborated: true,
    });
  });

  it("maps generic turn complete phrasing to idle", () => {
    expect(adapter.handleOscNotification?.(osc("Turn complete"))).toEqual({
      status: "idle",
      attention: "none",
      corroborated: true,
    });
  });

  it("maps plan-mode prompt OSC notify to needs_approval", () => {
    // Codex emits OSC 9 with body "Plan mode prompt: <title>" when it has
    // presented a plan and is waiting on the user to approve / edit / reject.
    expect(adapter.handleOscNotification?.(osc("Plan mode prompt: Plan Target"))).toEqual({
      status: "needs_approval",
      attention: "needs_approval",
      corroborated: true,
    });
  });

  it("maps non-approval OSC notify (notify-as-turn-complete) to idle", () => {
    // Codex 0.122+ emits OSC 9 per Growl/notify semantics: the body is the
    // assistant's response text (e.g. "Hi."), not a lifecycle keyword. Any
    // such notification corresponds to turn-complete → idle.
    expect(adapter.handleOscNotification?.(osc("Hi."))).toEqual({
      status: "idle",
      attention: "none",
      corroborated: true,
    });
    expect(adapter.handleOscNotification?.(osc("Hi! What should we work on?"))).toEqual({
      status: "idle",
      attention: "none",
      corroborated: true,
    });
  });

  it("returns null for empty OSC bodies", () => {
    expect(adapter.handleOscNotification?.(osc(""))).toBeNull();
  });

  it("maps status from JSON payload slugs in OSC body", () => {
    const n9: OscNotification = {
      code: 9,
      title: "",
      body: '{"type":"agent_turn_complete","v":1}',
      payload: { type: "agent_turn_complete", v: 1 },
    };
    expect(adapter.handleOscNotification?.(n9)).toEqual({
      status: "idle",
      attention: "none",
      corroborated: true,
    });
    const nOk: OscNotification = {
      code: 9,
      title: "",
      body: '{"event":"exec_approval_requested"}',
      payload: { event: "exec_approval_requested" },
    };
    expect(adapter.handleOscNotification?.(nOk)?.status).toBe("needs_approval");
  });
});

describe("codexIntentFor", () => {
  it("maps hook events to Lightcode intents", () => {
    expect(codexIntentFor("SessionStart", { hook_event_name: "SessionStart" }, false)).toBe(
      "session.started",
    );
    expect(codexIntentFor("UserPromptSubmit", { hook_event_name: "UserPromptSubmit" }, false)).toBe(
      "session.turn_started",
    );
    expect(
      codexIntentFor("PermissionRequest", { hook_event_name: "PermissionRequest" }, false),
    ).toBe("session.needs_approval");
    expect(codexIntentFor("Stop", { hook_event_name: "Stop" }, false)).toBe(
      "session.turn_finished",
    );
    expect(codexIntentFor("PreToolUse", { hook_event_name: "PreToolUse" }, false)).toBeUndefined();
    expect(codexIntentFor("PreToolUse", { hook_event_name: "PreToolUse" }, true)).toBe(
      "session.turn_started",
    );
  });
});

describe("mapCodexModels", () => {
  it("prefers high as the default effort when the default model supports it", () => {
    expect(
      mapCodexModels([
        {
          id: "gpt-5.4",
          model: "gpt-5.4",
          displayName: "gpt-5.4",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Low" },
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
          ],
        },
      ]),
    ).toMatchObject({
      defaultEffort: "high",
      efforts: ["low", "medium", "high"],
    });
  });
});
