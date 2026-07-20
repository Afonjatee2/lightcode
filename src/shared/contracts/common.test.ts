// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isThreadResultReady, isThreadTurnActive, type ThreadStatus } from "./common";

const ALL_STATUSES: ThreadStatus[] = [
  "inactive",
  "launching",
  "working",
  "idle",
  "finished",
  "needs_approval",
  "needs_reply",
  "error",
];

describe("thread status helpers", () => {
  it("isThreadTurnActive marks only the mid-turn states active", () => {
    expect(ALL_STATUSES.filter(isThreadTurnActive)).toEqual([
      "launching",
      "working",
      "needs_approval",
      "needs_reply",
    ]);
  });

  it("isThreadResultReady marks only settled-with-result states ready", () => {
    expect(ALL_STATUSES.filter(isThreadResultReady)).toEqual(["idle", "finished"]);
  });

  it("an errored candidate is neither turn-active nor result-ready", () => {
    // This is the crux of the experiment judge-gate fix: a failed candidate must
    // not count as active (which would block judging) nor as ready (which would
    // let it be judged with no result). It simply drops out of both sets.
    expect(isThreadTurnActive("error")).toBe(false);
    expect(isThreadResultReady("error")).toBe(false);
  });
});
