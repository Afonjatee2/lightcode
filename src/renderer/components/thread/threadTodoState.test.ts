import { describe, expect, it } from "vitest";
import type { AppStoreState } from "@/renderer/state/appStore";
import { getThreadTodoDockStateForItem, selectThreadTodoDockState } from "./threadTodoState";

describe("threadTodoState", () => {
  it("selects the latest structured plan item and tracks the active step", () => {
    const state = {
      runtimeItemIdsByThread: {
        t1: ["plan-old", "plan-new"],
      },
      runtimeItemsByIdByThread: {
        t1: {
          "plan-old": {
            id: "plan-old",
            type: "plan",
            state: "completed",
            payload: {
              steps: [{ step: "Old plan", status: "completed" }],
            },
            streams: {},
          },
          "plan-new": {
            id: "plan-new",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "Inspect output", status: "completed" },
                { step: "Open logs", status: "in_progress" },
                { step: "Patch UI", status: "pending" },
              ],
            },
            streams: {},
          },
        },
      },
    } as unknown as AppStoreState;

    expect(selectThreadTodoDockState(state, "t1")).toMatchObject({
      sourceItemId: "plan-new",
      activeIndex: 1,
      sourceKind: "steps",
      steps: [
        { text: "Inspect output", status: "completed" },
        { text: "Open logs", status: "in_progress" },
        { text: "Patch UI", status: "pending" },
      ],
    });
  });

  it("keeps the dock when a follow-up user_message arrives while the plan is unfinished", () => {
    const state = {
      runtimeItemIdsByThread: { t1: ["plan-1", "user-2"] },
      runtimeItemsByIdByThread: {
        t1: {
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "updated",
            payload: {
              steps: [
                { step: "Inspect output", status: "completed" },
                { step: "Open logs", status: "in_progress" },
                { step: "Patch UI", status: "pending" },
              ],
            },
            streams: {},
          },
          "user-2": { id: "user-2", type: "user_message", state: "completed", streams: {} },
        },
      },
    } as unknown as AppStoreState;

    expect(selectThreadTodoDockState(state, "t1")).toMatchObject({
      sourceItemId: "plan-1",
      activeIndex: 1,
    });
  });

  it("retires the dock once every step in the latest plan is completed", () => {
    const state = {
      runtimeItemIdsByThread: { t1: ["plan-1"] },
      runtimeItemsByIdByThread: {
        t1: {
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "completed",
            payload: {
              steps: [
                { step: "Step one", status: "completed" },
                { step: "Step two", status: "completed" },
              ],
            },
            streams: {},
          },
        },
      },
    } as unknown as AppStoreState;

    expect(selectThreadTodoDockState(state, "t1")).toBeNull();
  });

  it("parses codex plan_text lists into todo steps when no structured steps exist", () => {
    const todoState = getThreadTodoDockStateForItem({
      id: "plan-codex",
      type: "plan",
      state: "updated",
      payload: { steps: [] },
      streams: {
        plan_text: "- [x] Inspect output\n- [>] Open logs\n3. Patch UI",
      },
    });

    expect(todoState).toMatchObject({
      sourceItemId: "plan-codex",
      activeIndex: 1,
      sourceKind: "plan_text",
      steps: [
        { text: "Inspect output", status: "completed" },
        { text: "Open logs", status: "in_progress" },
        { text: "Patch UI", status: "pending" },
      ],
    });
  });
});
