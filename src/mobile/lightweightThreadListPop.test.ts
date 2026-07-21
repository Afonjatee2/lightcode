import { describe, expect, it } from "vitest";
import { shouldUseLightweightThreadListPop } from "./lightweightThreadListPop";

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
