import { describe, expect, it } from "vitest";
import { isIgnorableWindowError, isResizeObserverLoopError } from "./rendererGlobalErrors";

describe("rendererGlobalErrors", () => {
  it("recognizes browser ResizeObserver loop diagnostics", () => {
    expect(
      isResizeObserverLoopError(
        new Error("ResizeObserver loop completed with undelivered notifications."),
      ),
    ).toBe(true);
    expect(isResizeObserverLoopError("ResizeObserver loop limit exceeded")).toBe(true);
  });

  it("does not ignore normal errors", () => {
    expect(isResizeObserverLoopError(new Error("render failed"))).toBe(false);
  });

  it("ignores ResizeObserver loop window error events", () => {
    const event = new ErrorEvent("error", {
      message: "ResizeObserver loop completed with undelivered notifications.",
    });

    expect(isIgnorableWindowError(event)).toBe(true);
  });
});
