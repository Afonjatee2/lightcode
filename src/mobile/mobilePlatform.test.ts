import { afterEach, describe, expect, it, vi } from "vitest";
import { getMobileRuntimePlatform } from "./mobilePlatform";

describe("getMobileRuntimePlatform", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("identifies Windows browsers for platform-specific glass styling", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      platform: "Win32",
      maxTouchPoints: 0,
    });

    expect(getMobileRuntimePlatform()).toBe("windows");
  });
});
