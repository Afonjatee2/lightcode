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

  it("clearThreadRuntimeEvents drops items and requests for that thread only", () => {
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
  });
});
