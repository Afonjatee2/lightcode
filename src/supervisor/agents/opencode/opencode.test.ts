import { describe, expect, it } from "vitest";
import { createOpenCodeAdapter } from ".";
import { buildOpenCodeArgs } from "./argv";
import { opencodeIntentFor } from "./plugin/intentMap";
import { detectOpenCodeTerminalStatus, opencodeOscHint, opencodeOscTitleHint } from "./terminal";

describe("buildOpenCodeArgs", () => {
  it("emits no flags for a fresh launch with no model and no prompt", () => {
    expect(buildOpenCodeArgs({ model: "" }, "")).toEqual([]);
  });

  it("forwards model in provider/model form via --model", () => {
    expect(buildOpenCodeArgs({ model: "opencode/claude-haiku-4-5" }, "")).toEqual([
      "--model",
      "opencode/claude-haiku-4-5",
    ]);
  });

  it("encodes initial prompt via --prompt instead of positional", () => {
    expect(buildOpenCodeArgs({ model: "" }, "hello world")).toEqual(["--prompt", "hello world"]);
  });

  it("uses --session for resume", () => {
    expect(buildOpenCodeArgs({ model: "" }, "", "ses_abc123")).toEqual(["--session", "ses_abc123"]);
  });

  it("composes session, model, and prompt in order", () => {
    expect(
      buildOpenCodeArgs({ model: "opencode/gpt-5.4-mini" }, "continue please", "ses_abc"),
    ).toEqual([
      "--session",
      "ses_abc",
      "--model",
      "opencode/gpt-5.4-mini",
      "--prompt",
      "continue please",
    ]);
  });

  it("ignores whitespace-only prompts", () => {
    expect(buildOpenCodeArgs({ model: "" }, "   ")).toEqual([]);
  });
});

describe("opencodeOscTitleHint", () => {
  it("flips to working when title is prefixed by a braille spinner glyph", () => {
    expect(opencodeOscTitleHint({ code: 2, text: "⠋ working… (project)" })).toEqual({
      status: "working",
      attention: "working",
      corroborated: true,
    });
  });

  it("ignores titles without a braille prefix", () => {
    expect(opencodeOscTitleHint({ code: 2, text: "OpenCode (project)" })).toBeNull();
  });
});

describe("opencodeOscHint", () => {
  it("treats OSC 9;4;0 (remove progress) as idle", () => {
    expect(opencodeOscHint({ code: 9, body: "4;0", title: "", payload: undefined })).toEqual({
      status: "idle",
      attention: "none",
      corroborated: true,
    });
  });

  it("treats OSC 9;4;1 / 9;4;3 (set / indeterminate) as working", () => {
    expect(opencodeOscHint({ code: 9, body: "4;1;42", title: "", payload: undefined })).toEqual({
      status: "working",
      attention: "working",
      corroborated: true,
    });
    expect(opencodeOscHint({ code: 9, body: "4;3;0", title: "", payload: undefined })).toEqual({
      status: "working",
      attention: "working",
      corroborated: true,
    });
  });

  it("ignores progress sub-protocol bodies on non-9 OSC codes", () => {
    // 777 / 99 carriers don't trigger the iTerm2 4;<state> path even if their
    // body looks like a progress payload, because progress is OSC-9 specific.
    expect(opencodeOscHint({ code: 777, body: "4;1", title: "", payload: undefined })).toBeNull();
  });

  it("falls back to needs_approval on permission keywords in non-progress notifications", () => {
    expect(
      opencodeOscHint({
        code: 9,
        body: "permission requested",
        title: "OpenCode",
        payload: undefined,
      }),
    ).toEqual({ status: "needs_approval", attention: "needs_approval", corroborated: true });
  });
});

describe("detectOpenCodeTerminalStatus", () => {
  it("detects working from 'esc to interrupt' line", () => {
    expect(detectOpenCodeTerminalStatus("Working... (esc to interrupt)")?.status).toBe("working");
  });

  it("detects needs_approval from a [y/n] prompt", () => {
    expect(detectOpenCodeTerminalStatus("Allow this tool? [y/n]")?.status).toBe("needs_approval");
  });

  it("falls back to idle on a 'Type a message' footer", () => {
    expect(detectOpenCodeTerminalStatus("Type a message")).toEqual({
      status: "idle",
      attention: "none",
      corroborated: false,
    });
  });

  it("returns null when no pattern matches", () => {
    expect(detectOpenCodeTerminalStatus("nothing of note here")).toBeNull();
  });

  it("prefers a tail approval prompt over an earlier working line", () => {
    const text = "Working... (esc to interrupt)\nfinished step\nAllow tool? [y/n]";
    expect(detectOpenCodeTerminalStatus(text)?.status).toBe("needs_approval");
  });
});

describe("opencodeIntentFor", () => {
  it("maps OpenCode lifecycle hooks to Lightcode intents", () => {
    expect(opencodeIntentFor("session.created")).toBe("session.started");
    expect(opencodeIntentFor("tool.execute.before")).toBe("session.turn_started");
    expect(opencodeIntentFor("permission.asked")).toBe("session.needs_approval");
    expect(opencodeIntentFor("session.idle")).toBe("session.turn_finished");
    expect(opencodeIntentFor("session.error")).toBe("session.turn_errored");
  });

  it("returns undefined for unmapped events", () => {
    expect(opencodeIntentFor("tool.execute.after")).toBeUndefined();
    expect(opencodeIntentFor("session.updated")).toBeUndefined();
  });
});

describe("createOpenCodeAdapter", () => {
  it("declares the in-process plugin metadata and identity", () => {
    const adapter = createOpenCodeAdapter();
    expect(adapter.kind).toBe("opencode");
    expect(adapter.label).toBe("OpenCode");
    expect(adapter.pluginId).toBe("lightcode-status@opencode");
    expect(adapter.minProtocolVersion).toBe(1);
  });

  it("returns no extra args/env from pluginLaunchExtras (in-process plugin)", async () => {
    const adapter = createOpenCodeAdapter();
    const extras = await adapter.pluginLaunchExtras?.({ envKind: "posix" });
    expect(extras).toEqual({});
    expect(extras?.args).toBeUndefined();
    expect(extras?.env).toBeUndefined();
  });

  it("only allows hook-active terminal fallback for needs_approval", () => {
    const adapter = createOpenCodeAdapter();
    expect(
      adapter.shouldApplyTerminalStatusWhileHookActive?.({
        status: "needs_approval",
        attention: "needs_approval",
      }),
    ).toBe(true);
    expect(
      adapter.shouldApplyTerminalStatusWhileHookActive?.({
        status: "working",
        attention: "working",
      }),
    ).toBe(false);
    expect(
      adapter.shouldApplyTerminalStatusWhileHookActive?.({ status: "idle", attention: "none" }),
    ).toBe(false);
  });

  it("builds a `run --format json` one-shot command piped via stdin", () => {
    const adapter = createOpenCodeAdapter();
    const cmd = adapter.buildOneShotCommand?.("opencode/claude-haiku-4-5", undefined, "say hi");
    expect(cmd).toEqual({
      command: "opencode",
      args: ["run", "--format", "json", "--model", "opencode/claude-haiku-4-5", "say hi"],
      stdin: "",
    });
  });

  it("returns undefined for buildOneShotCommand when no prompt is supplied", () => {
    const adapter = createOpenCodeAdapter();
    expect(
      adapter.buildOneShotCommand?.("opencode/claude-haiku-4-5", undefined, undefined),
    ).toBeUndefined();
  });
});
