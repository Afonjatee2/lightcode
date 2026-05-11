import { describe, expect, it } from "vitest";
import type { AppStoreState } from "@/renderer/state/appStore";
import {
  selectVisibleThreadRuntimeItemIds,
  selectVisibleThreadTimelineEntries,
} from "./chatPaneSelectors";

describe("chatPaneSelectors", () => {
  it("keeps completed reasoning items in the transcript so the user can expand them later", () => {
    // The `Reasoning` component renders a collapsed "Thought" disclosure for
    // completed items with text. Filtering them out here would erase that
    // affordance entirely.
    const state = {
      runtimeItemIdsByThread: {
        t1: ["user-1", "reasoning-1", "assistant-1"],
      },
      runtimeItemsByIdByThread: {
        t1: {
          "user-1": {
            id: "user-1",
            type: "user_message",
            state: "completed",
            streams: {},
          },
          "reasoning-1": {
            id: "reasoning-1",
            type: "reasoning",
            state: "completed",
            streams: { reasoning_text: "thinking" },
          },
          "assistant-1": {
            id: "assistant-1",
            type: "assistant_message",
            state: "completed",
            streams: { assistant_text: "done" },
          },
        },
      },
    } as unknown as AppStoreState;

    expect(selectVisibleThreadRuntimeItemIds(state, "t1")).toEqual([
      "user-1",
      "reasoning-1",
      "assistant-1",
    ]);
  });

  it("can hide a runtime item that is rendered in a pinned surface instead", () => {
    const state = {
      runtimeItemIdsByThread: {
        t1: ["assistant-1", "plan-1", "plan-2", "assistant-2"],
      },
      runtimeItemsByIdByThread: {
        t1: {
          "assistant-1": {
            id: "assistant-1",
            type: "assistant_message",
            state: "completed",
            streams: { assistant_text: "before" },
          },
          "plan-1": {
            id: "plan-1",
            type: "plan",
            state: "updated",
            streams: { plan_text: "- [ ] Build dock" },
          },
          "plan-2": {
            id: "plan-2",
            type: "plan",
            state: "updated",
            streams: { plan_text: "- [ ] Keep dock only" },
          },
          "assistant-2": {
            id: "assistant-2",
            type: "assistant_message",
            state: "completed",
            streams: { assistant_text: "after" },
          },
        },
      },
    } as unknown as AppStoreState;

    expect(selectVisibleThreadRuntimeItemIds(state, "t1", "plan-1")).toEqual([
      "assistant-1",
      "assistant-2",
    ]);
  });

  it("groups adjacent tool calls into one timeline entry", () => {
    const state = {
      runtimeItemIdsByThread: {
        t1: ["assistant-1", "tool-1", "command-1", "assistant-2", "tool-3"],
      },
      runtimeItemsByIdByThread: {
        t1: {
          "assistant-1": {
            id: "assistant-1",
            type: "assistant_message",
            state: "completed",
            streams: { assistant_text: "before" },
          },
          "tool-1": {
            id: "tool-1",
            type: "tool_call",
            state: "completed",
            payload: { name: "Viewing src/a.ts", status: "success" },
            streams: {},
          },
          "command-1": {
            id: "command-1",
            type: "command_execution",
            state: "completed",
            payload: { command: "pnpm run lint" },
            streams: {},
          },
          "assistant-2": {
            id: "assistant-2",
            type: "assistant_message",
            state: "completed",
            streams: { assistant_text: "after" },
          },
          "tool-3": {
            id: "tool-3",
            type: "tool_call",
            state: "completed",
            payload: { name: "Viewing src/b.ts", status: "success" },
            streams: {},
          },
        },
      },
    } as unknown as AppStoreState;

    expect(selectVisibleThreadTimelineEntries(state, "t1")).toEqual([
      { kind: "item", id: "assistant-1" },
      {
        kind: "tool_call_group",
        id: "tool-call-group:tool-1:command-1:2",
        itemIds: ["tool-1", "command-1"],
      },
      { kind: "item", id: "assistant-2" },
      { kind: "item", id: "tool-3" },
    ]);
  });

  it("groups adjacent canonical file changes with other tool calls", () => {
    const state = {
      runtimeItemIdsByThread: {
        t1: ["assistant-1", "edit-1", "edit-2", "command-1", "assistant-2", "edit-3"],
      },
      runtimeItemsByIdByThread: {
        t1: {
          "assistant-1": {
            id: "assistant-1",
            type: "assistant_message",
            state: "completed",
            streams: { assistant_text: "before" },
          },
          "edit-1": {
            id: "edit-1",
            type: "file_change",
            state: "completed",
            payload: {
              path: "src/renderer/components/thread/ThreadComposer.tsx",
              changeKind: "edit",
            },
            streams: {},
          },
          "edit-2": {
            id: "edit-2",
            type: "file_change",
            state: "completed",
            payload: {
              path: "src/renderer/components/thread/ThreadComposer.tsx",
              changeKind: "edit",
            },
            streams: {},
          },
          "command-1": {
            id: "command-1",
            type: "command_execution",
            state: "completed",
            payload: { command: "pnpm run typecheck" },
            streams: {},
          },
          "assistant-2": {
            id: "assistant-2",
            type: "assistant_message",
            state: "completed",
            streams: { assistant_text: "after" },
          },
          "edit-3": {
            id: "edit-3",
            type: "file_change",
            state: "completed",
            payload: {
              path: "src/renderer/components/thread/ThreadComposer.tsx",
              changeKind: "edit",
            },
            streams: {},
          },
        },
      },
    } as unknown as AppStoreState;

    expect(selectVisibleThreadTimelineEntries(state, "t1")).toEqual([
      { kind: "item", id: "assistant-1" },
      {
        kind: "tool_call_group",
        id: "tool-call-group:edit-1:command-1:3",
        itemIds: ["edit-1", "edit-2", "command-1"],
      },
      { kind: "item", id: "assistant-2" },
      { kind: "item", id: "edit-3" },
    ]);
  });
});
