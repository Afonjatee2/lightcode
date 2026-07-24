import { describe, expect, it } from "vitest";
import {
  shouldUseLightweightSubAgentPop,
  shouldUseLightweightSubAgentPush,
  shouldUseLightweightThreadListPop,
} from "./lightweightThreadListPop";

describe("shouldUseLightweightThreadListPop", () => {
  it("uses the lightweight pop only for an iOS web thread returning to the list", () => {
    expect(
      shouldUseLightweightThreadListPop("/thread/long", "/threads", {
        platform: "ios",
        nativeApp: false,
      }),
    ).toBe(true);
    expect(
      shouldUseLightweightThreadListPop("/thread/long", "/threads", {
        platform: "ios",
        nativeApp: true,
      }),
    ).toBe(false);
    expect(
      shouldUseLightweightThreadListPop("/thread/long", "/threads", {
        platform: "android",
        nativeApp: false,
      }),
    ).toBe(false);
  });

  it("keeps ordinary iOS web navigations on the paired View Transition path", () => {
    const runtime = { platform: "ios", nativeApp: false } as const;
    expect(shouldUseLightweightThreadListPop("/threads", "/thread/long", runtime)).toBe(false);
    expect(shouldUseLightweightThreadListPop("/thread/long", "/workspace/long", runtime)).toBe(
      false,
    );
    expect(shouldUseLightweightThreadListPop("/settings", "/threads", runtime)).toBe(false);
  });
});

describe("shouldUseLightweightSubAgentPush", () => {
  it("uses the lightweight push only for an iOS web thread opening its own subagent", () => {
    const runtime = { platform: "ios", nativeApp: false } as const;
    expect(
      shouldUseLightweightSubAgentPush("/thread/thread-1", "/subagent/thread-1/parent-1", runtime),
    ).toBe(true);
    expect(
      shouldUseLightweightSubAgentPush("/thread/thread-1", "/subagent/thread-2/parent-1", runtime),
    ).toBe(false);
    expect(
      shouldUseLightweightSubAgentPush("/thread/thread-1", "/subagent/thread-1/parent-1", {
        platform: "ios",
        nativeApp: true,
      }),
    ).toBe(false);
  });
});

describe("shouldUseLightweightSubAgentPop", () => {
  it("uses the lightweight pop only when an iOS web subagent returns to its parent", () => {
    const runtime = { platform: "ios", nativeApp: false } as const;
    expect(
      shouldUseLightweightSubAgentPop("/subagent/thread-1/parent-1", "/thread/thread-1", runtime),
    ).toBe(true);
    expect(
      shouldUseLightweightSubAgentPop("/subagent/thread-1/parent-1", "/thread/thread-2", runtime),
    ).toBe(false);
    expect(
      shouldUseLightweightSubAgentPop("/subagent/thread-1/parent-1", "/thread/thread-1", {
        platform: "android",
        nativeApp: false,
      }),
    ).toBe(false);
  });
});
