import { describe, expect, it } from "vitest";
import type { CompletedTurnRecord, RuntimeChatItem } from "./slices/runtimeEventSlice";
import { prepareRuntimeSnapshotForPersistence } from "./chatRuntimePersister";

function makeItem(
  input: Partial<RuntimeChatItem> & Pick<RuntimeChatItem, "id" | "type">,
): RuntimeChatItem {
  return {
    id: input.id,
    type: input.type,
    state: input.state ?? "completed",
    streams: input.streams ?? {},
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    ...(input.parentItemId ? { parentItemId: input.parentItemId } : {}),
  };
}

function makeTurn(anchorItemId: string | null): CompletedTurnRecord {
  return { startedAt: 1, endedAt: 2, anchorItemId };
}

describe("prepareRuntimeSnapshotForPersistence", () => {
  it("remaps completed-turn anchors to the persisted summary id for compacted runs", () => {
    const snapshot = prepareRuntimeSnapshotForPersistence(
      [
        makeItem({ id: "assistant-1", type: "assistant_message" }),
        makeItem({
          id: "tool-1",
          type: "tool_call",
          payload: { name: "Viewing src/a.ts", status: "success" },
        }),
        makeItem({ id: "search-1", type: "web_search" }),
        makeItem({
          id: "command-1",
          type: "command_execution",
          payload: { command: "pnpm run test", exitCode: 0 },
        }),
        makeItem({ id: "assistant-2", type: "assistant_message" }),
      ],
      [makeTurn("tool-1"), makeTurn("search-1"), makeTurn("command-1")],
    );

    const summaryId = "tool-call-summary:tool-1:command-1:3";
    expect(snapshot.items.map((item) => item.id)).toEqual([
      "assistant-1",
      summaryId,
      "assistant-2",
    ]);
    expect(snapshot.turns.map((turn) => turn.anchorItemId)).toEqual([
      summaryId,
      summaryId,
      summaryId,
    ]);
  });

  it("does not compact edits together with other tool calls", () => {
    const snapshot = prepareRuntimeSnapshotForPersistence(
      [
        makeItem({ id: "assistant-1", type: "assistant_message" }),
        makeItem({
          id: "edit-1",
          type: "file_change",
          payload: { path: "src/foo.ts", changeKind: "edit" },
        }),
        makeItem({
          id: "edit-2",
          type: "file_change",
          payload: { path: "src/foo.ts", changeKind: "edit" },
        }),
        makeItem({
          id: "command-1",
          type: "command_execution",
          payload: { command: "pnpm run typecheck", exitCode: 0 },
        }),
        makeItem({
          id: "command-2",
          type: "command_execution",
          payload: { command: "pnpm run lint", exitCode: 0 },
        }),
        makeItem({
          id: "edit-3",
          type: "file_change",
          payload: { path: "src/bar.ts", changeKind: "edit" },
        }),
      ],
      [makeTurn("edit-1"), makeTurn("edit-2"), makeTurn("command-1"), makeTurn("edit-3")],
    );

    const editSummaryId = "tool-call-summary:edit-1:edit-2:2";
    const commandSummaryId = "tool-call-summary:command-1:command-2:2";
    expect(snapshot.items.map((item) => item.id)).toEqual([
      "assistant-1",
      editSummaryId,
      commandSummaryId,
      "edit-3",
    ]);
    expect(snapshot.turns.map((turn) => turn.anchorItemId)).toEqual([
      editSummaryId,
      editSummaryId,
      commandSummaryId,
      "edit-3",
    ]);
  });

  it("keeps dropped-anchor markers attached to the previous surviving row", () => {
    const snapshot = prepareRuntimeSnapshotForPersistence(
      [
        makeItem({ id: "assistant-1", type: "assistant_message" }),
        makeItem({
          id: "reason-1",
          type: "reasoning",
          streams: { reasoning_text: "   " },
        }),
        makeItem({ id: "assistant-2", type: "assistant_message" }),
      ],
      [makeTurn("reason-1")],
    );

    expect(snapshot.items.map((item) => item.id)).toEqual(["assistant-1", "assistant-2"]);
    expect(snapshot.turns[0]?.anchorItemId).toBe("assistant-1");
  });
});
