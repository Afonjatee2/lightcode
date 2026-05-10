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
        makeItem({ id: "file-1", type: "file_change" }),
        makeItem({ id: "search-1", type: "web_search" }),
        makeItem({ id: "assistant-2", type: "assistant_message" }),
      ],
      [makeTurn("tool-1"), makeTurn("file-1"), makeTurn("search-1")],
    );

    const summaryId = "tool-call-summary:tool-1:search-1:3";
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
