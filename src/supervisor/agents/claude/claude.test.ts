import { describe, expect, it } from "vitest";
import { createClaudeAdapter } from "./index";
import type { OscNotification, OscTitle } from "@/shared/osc";

function oscTitle(text: string, code: 0 | 1 | 2 = 0): OscTitle {
  return { code, text };
}

function oscNotify(body: string, code: 9 | 99 | 777 = 9): OscNotification {
  return { code, title: "", body, payload: undefined };
}

describe("createClaudeAdapter handleOscTitle", () => {
  const adapter = createClaudeAdapter();

  // Observed from real dev sessions (~/.lightcode/logs/terminal/*.log):
  //   124× "⠂ <task title>"  /  121× "⠐ <task title>"  /  10× "✳ <task title>"
  // The braille 2-frame animation (⠂ / ⠐, U+2802 / U+2810) is the stable
  // "working" signal; ✳ appeared rarely and was classified as an artifact.
  it("maps Claude's 2-frame braille spinner (⠂ / ⠐) to working", () => {
    for (const glyph of ["⠂", "⠐"]) {
      expect(adapter.handleOscTitle?.(oscTitle(`${glyph} Add jump to bottom button`))).toEqual({
        status: "working",
        attention: "working",
        corroborated: true,
      });
    }
  });

  it("accepts any glyph in the braille range (U+2800–U+28FF)", () => {
    for (const glyph of ["⠀", "⠁", "⠄", "⣾", "⣿"]) {
      expect(adapter.handleOscTitle?.(oscTitle(`${glyph} task`))?.status).toBe("working");
    }
  });

  it("returns null for Claude's idle titles (no spinner prefix)", () => {
    // At startup Claude sets these; they are NOT a working signal.
    expect(adapter.handleOscTitle?.(oscTitle("claude"))).toBeNull();
    expect(adapter.handleOscTitle?.(oscTitle("Claude Code"))).toBeNull();
  });

  it("returns null when the braille glyph is not at the start of the title", () => {
    expect(adapter.handleOscTitle?.(oscTitle("Claude Code ⠂"))).toBeNull();
  });
});

describe("createClaudeAdapter handleOscNotification (iTerm2 OSC 9;4 progress)", () => {
  const adapter = createClaudeAdapter();

  // Real bodies observed in ~/.lightcode-dev/logs/terminal/*.log after the
  // `preferredNotifChannel: "iterm2"` settings flip: "4;0;", "4;0;0", "4;3;0".
  // See plugin/install.ts for the settings wiring.
  it("maps state 0 (remove progress) to idle", () => {
    for (const body of ["4;0", "4;0;", "4;0;0"]) {
      expect(adapter.handleOscNotification?.(oscNotify(body))).toEqual({
        status: "idle",
        attention: "none",
        corroborated: true,
      });
    }
  });

  it("maps state 3 (indeterminate) to working — Claude's in-turn signal", () => {
    expect(adapter.handleOscNotification?.(oscNotify("4;3;0"))).toEqual({
      status: "working",
      attention: "working",
      corroborated: true,
    });
  });

  it("maps state 1 (determinate progress) to working", () => {
    expect(adapter.handleOscNotification?.(oscNotify("4;1;42"))).toEqual({
      status: "working",
      attention: "working",
      corroborated: true,
    });
  });

  it("ignores states 2 (error) and 4 (paused) — no clean mapping", () => {
    expect(adapter.handleOscNotification?.(oscNotify("4;2"))).toBeNull();
    expect(adapter.handleOscNotification?.(oscNotify("4;4;0"))).toBeNull();
  });

  it("ignores OSC 9 bodies that aren't the 9;4 progress sub-protocol", () => {
    // Codex-style plain-text OSC 9 (turn-end notify with response text) must
    // not accidentally flip Claude to idle/working — Claude is configured for
    // iTerm2 progress only, so a non-`4;` body is a foreign signal.
    expect(adapter.handleOscNotification?.(oscNotify("Hello from some other agent"))).toBeNull();
    expect(adapter.handleOscNotification?.(oscNotify(""))).toBeNull();
  });

  it("ignores OSC 777 / OSC 99 — Claude only speaks iTerm2 OSC 9", () => {
    expect(adapter.handleOscNotification?.(oscNotify("4;0", 777))).toBeNull();
    expect(adapter.handleOscNotification?.(oscNotify("4;3;0", 99))).toBeNull();
  });
});
