import { describe, expect, it, beforeEach } from "vitest";
import { create } from "zustand";
import type { RuntimeEvent } from "@/shared/contracts";
import { createRuntimeEventSlice, type RuntimeEventSlice } from "./runtimeEventSlice";

/**
 * Reducer tests for the runtime event slice. Exercise it as a standalone
 * Zustand store so the rest of the app store doesn't have to be wired up.
 */
function makeStore() {
  return create<RuntimeEventSlice>()((set, get, store) =>
    // Cast — the slice's `SliceCreator<T>` parameter expects the full app
    // state, but the slice itself only touches its own keys. Safe in tests.
    createRuntimeEventSlice(set as never, get as never, store as never),
  );
}

describe("runtimeEventSlice.applyRuntimeEvent", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  function apply(threadId: string, event: RuntimeEvent) {
    store.getState().applyRuntimeEvent(threadId, event);
  }

  it("appends a new item on item.started", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "i1",
      itemType: "assistant_message",
    });
    const state = store.getState();
    expect(state.runtimeItemIdsByThread["t1"]).toEqual(["i1"]);
    expect(state.runtimeItemsByIdByThread["t1"]?.["i1"]).toMatchObject({
      id: "i1",
      type: "assistant_message",
      state: "started",
    });
  });

  it("is idempotent for repeated item.started with the same id", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "i1",
      itemType: "assistant_message",
    });
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "i1",
      itemType: "assistant_message",
    });
    expect(store.getState().runtimeItemIdsByThread["t1"]).toEqual(["i1"]);
  });

  it("accumulates content.delta into the right stream bucket", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "i1",
      itemType: "assistant_message",
    });
    apply("t1", {
      type: "content.delta",
      threadId: "t1",
      itemId: "i1",
      stream: "assistant_text",
      delta: "Hello",
    });
    apply("t1", {
      type: "content.delta",
      threadId: "t1",
      itemId: "i1",
      stream: "assistant_text",
      delta: " world",
    });
    expect(store.getState().runtimeItemsByIdByThread["t1"]?.["i1"]?.streams.assistant_text).toBe(
      "Hello world",
    );
  });

  it("deduplicates overlapping streamed chunks", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "i1",
      itemType: "assistant_message",
    });
    apply("t1", {
      type: "content.delta",
      threadId: "t1",
      itemId: "i1",
      stream: "assistant_text",
      delta: "WorkingWorking through through tasks tasks.",
    });
    apply("t1", {
      type: "content.delta",
      threadId: "t1",
      itemId: "i1",
      stream: "assistant_text",
      delta: " tasks tasks. What What do do you you need need done done??",
    });
    expect(store.getState().runtimeItemsByIdByThread["t1"]?.["i1"]?.streams.assistant_text).toBe(
      "WorkingWorking through through tasks tasks. What What do do you you need need done done??",
    );
  });

  it("locks state at 'completed' even after later updates land", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "i1",
      itemType: "assistant_message",
    });
    apply("t1", { type: "item.completed", threadId: "t1", itemId: "i1" });
    apply("t1", {
      type: "content.delta",
      threadId: "t1",
      itemId: "i1",
      stream: "assistant_text",
      delta: "late",
    });
    const item = store.getState().runtimeItemsByIdByThread["t1"]?.["i1"];
    expect(item?.state).toBe("completed");
    expect(item?.streams.assistant_text).toBe("late"); // delta still appends, but state stays completed
  });

  it("drops a reasoning item on item.completed when no text was streamed", () => {
    // Some agents emit a reasoning bracket that never produces text. Keeping
    // it in the timeline would split otherwise-adjacent tool calls into
    // separate groups, so the slice prunes it on completion.
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "tool-1",
      itemType: "tool_call",
    });
    apply("t1", {
      type: "item.completed",
      threadId: "t1",
      itemId: "tool-1",
    });
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "reason-1",
      itemType: "reasoning",
    });
    apply("t1", {
      type: "item.completed",
      threadId: "t1",
      itemId: "reason-1",
    });
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "tool-2",
      itemType: "tool_call",
    });
    const state = store.getState();
    expect(state.runtimeItemIdsByThread["t1"]).toEqual(["tool-1", "tool-2"]);
    expect(state.runtimeItemsByIdByThread["t1"]?.["reason-1"]).toBeUndefined();
  });

  it("keeps a reasoning item that completed with text", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "reason-1",
      itemType: "reasoning",
    });
    apply("t1", {
      type: "content.delta",
      threadId: "t1",
      itemId: "reason-1",
      stream: "reasoning_text",
      delta: "thinking…",
    });
    apply("t1", {
      type: "item.completed",
      threadId: "t1",
      itemId: "reason-1",
    });
    const state = store.getState();
    expect(state.runtimeItemIdsByThread["t1"]).toEqual(["reason-1"]);
    expect(state.runtimeItemsByIdByThread["t1"]?.["reason-1"]?.streams.reasoning_text).toBe(
      "thinking…",
    );
  });

  it("drops Copilot-style subagent children when the parent completes", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "tool-parent",
      itemType: "tool_call",
      payload: {
        name: "Critiquing path fixes",
        title: "Critiquing path fixes",
        status: "running",
        isSubAgent: true,
        args: {
          description: "Critiquing path fixes",
          agent_type: "rubber-duck",
          name: "path-fix-duck",
          prompt: "We need to get a clean green run.",
        },
      },
    });
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "child-1",
      itemType: "assistant_message",
      parentItemId: "tool-parent",
    });
    apply("t1", {
      type: "item.completed",
      threadId: "t1",
      itemId: "tool-parent",
      payload: { status: "success" },
    });
    const state = store.getState();
    expect(state.runtimeItemIdsByThread["t1"]).toEqual(["tool-parent"]);
    expect(state.runtimeItemsByIdByThread["t1"]?.["child-1"]).toBeUndefined();
  });

  it("opens and resolves runtime requests", () => {
    apply("t1", {
      type: "request.opened",
      threadId: "t1",
      requestId: "r1",
      requestType: "command_execution_approval",
      payload: { summary: "Run script.sh" },
    });
    expect(store.getState().runtimeRequestsByThread["t1"]).toHaveLength(1);

    apply("t1", { type: "request.resolved", threadId: "t1", requestId: "r1", outcome: "accepted" });
    expect(store.getState().runtimeRequestsByThread["t1"]).toHaveLength(0);
  });

  it("synthesises an inline error item on error events", () => {
    apply("t1", { type: "error", threadId: "t1", message: "boom" });
    const state = store.getState();
    expect(state.runtimeItemIdsByThread["t1"]).toHaveLength(1);
    const errorItemId = state.runtimeItemIdsByThread["t1"]?.[0];
    expect(errorItemId).toBeTruthy();
    expect(state.runtimeItemsByIdByThread["t1"]?.[errorItemId!]).toMatchObject({
      type: "error",
      state: "completed",
      payload: { message: "boom" },
    });
  });

  it("clearThreadRuntimeEvents drops items and requests for that thread only and marks persistence dirty", () => {
    apply("t1", {
      type: "item.started",
      threadId: "t1",
      itemId: "i1",
      itemType: "user_message",
    });
    apply("t2", {
      type: "item.started",
      threadId: "t2",
      itemId: "i2",
      itemType: "user_message",
    });
    apply("t1", {
      type: "request.opened",
      threadId: "t1",
      requestId: "r1",
      requestType: "tool_user_input",
      payload: { summary: "Pick" },
    });

    store.getState().clearThreadRuntimeEvents("t1");

    expect(store.getState().runtimeItemIdsByThread["t1"]).toBeUndefined();
    expect(store.getState().runtimeItemsByIdByThread["t1"]).toBeUndefined();
    expect(store.getState().runtimeRequestsByThread["t1"]).toBeUndefined();
    expect(store.getState().runtimeItemIdsByThread["t2"]).toEqual(["i2"]);
    expect(store.getState().runtimeDirtyThreadIds).toContain("t1");
  });

  it("merges persisted completed turns with live turns during hydration", () => {
    store
      .getState()
      .hydrateThreadCompletedTurns("t1", [{ startedAt: 20, endedAt: 30, anchorItemId: "live" }]);
    store.getState().hydrateThreadCompletedTurns("t1", [
      { startedAt: 1, endedAt: 10, anchorItemId: "old" },
      { startedAt: 20, endedAt: 30, anchorItemId: "live" },
    ]);

    expect(store.getState().runtimeCompletedTurnsByThread["t1"]).toEqual([
      { startedAt: 1, endedAt: 10, anchorItemId: "old" },
      { startedAt: 20, endedAt: 30, anchorItemId: "live" },
    ]);
  });
});
