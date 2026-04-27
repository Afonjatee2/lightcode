import { describe, expect, it } from "vitest";
import {
  createCodexAdapter,
  deriveCodexStructuredState,
  detectCodexReadyForInitialPrompt,
  detectCodexUpdatePrompt,
  parseCodexSocketMessage,
} from "./index";
import type { OscNotification, OscTitle } from "@/shared/osc";
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

function oscTitle(text: string, code: 0 | 1 | 2 = 0): OscTitle {
  return { code, text };
}

describe("createCodexAdapter handleOscTitle", () => {
  const adapter = createCodexAdapter();

  it("maps braille-prefixed titles to working (Codex spinner glyphs)", () => {
    expect(adapter.handleOscTitle?.(oscTitle("⠋ Working (5s • esc to interrupt)"))).toEqual({
      status: "working",
      attention: "working",
      corroborated: true,
    });
    expect(adapter.handleOscTitle?.(oscTitle("⠸ Thinking"))).toEqual({
      status: "working",
      attention: "working",
      corroborated: true,
    });
  });

  it("accepts any glyph in the braille range (U+2800–U+28FF)", () => {
    for (const glyph of ["⠀", "⠁", "⠂", "⠐", "⣾", "⣿"]) {
      expect(adapter.handleOscTitle?.(oscTitle(`${glyph} anything`))?.status).toBe("working");
    }
  });

  it("returns null for the idle title with no spinner prefix", () => {
    expect(adapter.handleOscTitle?.(oscTitle("codex"))).toBeNull();
    expect(adapter.handleOscTitle?.(oscTitle("Codex"))).toBeNull();
  });

  it("returns null when the braille glyph is not leading", () => {
    // A braille glyph mid-string is not Codex's working spinner — don't match.
    expect(adapter.handleOscTitle?.(oscTitle("codex ⠸"))).toBeNull();
  });

  it("returns null for OSC 1 (icon name) with a plain app name", () => {
    expect(adapter.handleOscTitle?.(oscTitle("codex", 1))).toBeNull();
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
  it("promotes GPT-5.5 to the Codex default model when available", () => {
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
          ],
        },
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "gpt-5.5",
          hidden: false,
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
          ],
        },
      ]),
    ).toMatchObject({
      models: [
        { id: "gpt-5.5", label: "5.5" },
        { id: "gpt-5.4", label: "5.4" },
      ],
      defaultEffort: "high",
    });
  });

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
