import { describe, expect, it } from "vitest";
import {
  isCodexSemverSupportedForHooks,
  mergeCodexHooksDocument,
  parseCodexVersionLine,
} from "./install";

const forwardPath = "C:\\Users\\demo\\.lightcode\\agent-plugins\\codex\\forward.mjs";
const forwardPathUnix = "/home/demo/.lightcode/agent-plugins/codex/forward.mjs";

function lightcodeCommand(fp: string, event: string): string {
  return `node ${JSON.stringify(fp)} ${event}`;
}

describe("parseCodexVersionLine + isCodexSemverSupportedForHooks", () => {
  it("parses codex-cli semver lines", () => {
    expect(parseCodexVersionLine("codex-cli 0.122.0")).toEqual([0, 122, 0]);
    expect(parseCodexVersionLine("codex-cli 0.121.99")).toEqual([0, 121, 99]);
    expect(parseCodexVersionLine("  codex-cli 1.0.0  ")).toEqual([1, 0, 0]);
  });

  it("returns null for unexpected output", () => {
    expect(parseCodexVersionLine("codex 0.122.0")).toBeNull();
    expect(parseCodexVersionLine("")).toBeNull();
  });

  it("gates hooks support at 0.122.0", () => {
    expect(isCodexSemverSupportedForHooks([0, 121, 0])).toBe(false);
    expect(isCodexSemverSupportedForHooks([0, 121, 99])).toBe(false);
    expect(isCodexSemverSupportedForHooks([0, 122, 0])).toBe(true);
    expect(isCodexSemverSupportedForHooks([0, 123, 0])).toBe(true);
    expect(isCodexSemverSupportedForHooks(null)).toBe(false);
  });
});

describe("mergeCodexHooksDocument", () => {
  it("creates only Lightcode entries when hooks.json was absent", () => {
    const doc = mergeCodexHooksDocument(null, forwardPath);
    expect(Object.keys(doc.hooks)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "Stop",
    ]);
    const stop = doc.hooks.Stop as unknown[];
    expect(stop).toHaveLength(1);
    const stopHook = (stop[0] as { hooks: { command: string }[] }).hooks[0];
    expect(stopHook?.command).toBe(lightcodeCommand(forwardPath, "Stop"));
  });

  it("preserves user matcher groups and appends Lightcode", () => {
    const userGroup = {
      matcher: "*",
      hooks: [{ type: "command", command: "node user-script.js" }],
    };
    const existing = {
      hooks: {
        Stop: [userGroup],
        SessionStart: [],
      },
    };
    const doc = mergeCodexHooksDocument(existing, forwardPath);
    const stop = doc.hooks.Stop as unknown[];
    expect(stop).toHaveLength(2);
    expect(stop[0]).toEqual(userGroup);
    const lc = (stop[1] as { hooks: { command: string }[] }).hooks[0];
    expect(lc?.command).toBe(lightcodeCommand(forwardPath, "Stop"));
  });

  it("prunes stale Lightcode groups by forward.mjs path fingerprint and replaces", () => {
    const stale = {
      hooks: [
        {
          type: "command",
          command: `node "C:\\old\\.lightcode\\agent-plugins\\codex\\forward.mjs" Stop`,
        },
      ],
    };
    const existing = { hooks: { Stop: [stale] } };
    const doc = mergeCodexHooksDocument(existing, forwardPath);
    const stop = doc.hooks.Stop as unknown[];
    expect(stop).toHaveLength(1);
    const h = (stop[0] as { hooks: { command: string }[] }).hooks[0];
    expect(h?.command).toBe(lightcodeCommand(forwardPath, "Stop"));
  });

  it("is idempotent when re-run with the same forward path", () => {
    const first = mergeCodexHooksDocument(null, forwardPathUnix);
    const second = mergeCodexHooksDocument(first, forwardPathUnix);
    expect(second).toEqual(first);
  });

  it("is idempotent when re-run with the same Windows forward path", () => {
    const first = mergeCodexHooksDocument(null, forwardPath);
    const second = mergeCodexHooksDocument(first, forwardPath);
    expect(second).toEqual(first);
  });

  it("uses matcher only for SessionStart, PreToolUse, PostToolUse", () => {
    const doc = mergeCodexHooksDocument(null, forwardPath);
    expect((doc.hooks.SessionStart as { matcher?: string }[])[0]).toMatchObject({
      matcher: "*",
    });
    expect((doc.hooks.UserPromptSubmit as { matcher?: string }[])[0]?.matcher).toBeUndefined();
    expect((doc.hooks.PermissionRequest as { matcher?: string }[])[0]?.matcher).toBeUndefined();
    expect((doc.hooks.Stop as { matcher?: string }[])[0]?.matcher).toBeUndefined();
  });
});
