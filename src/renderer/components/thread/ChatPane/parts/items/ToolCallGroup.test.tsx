import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { ToolCallGroup } from "./ToolCallGroup";

describe("ToolCallGroup", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
      runtimeRequestsByThread: {},
      runtimeStructuralVersionByThread: {},
    });
  });

  it("renders only the last 8 rows when collapsed and reveals the rest via Show all", () => {
    const threadId = "thread-1";
    const items = Array.from({ length: 10 }, (_, index) =>
      makeToolItem(`tool-${index + 1}`, `Read file ${index + 1}`),
    );
    seedThread(threadId, items);

    const view = renderToolCallGroup(
      threadId,
      items.map((item) => item.id),
    );
    const viewport = getViewport(view.container);

    expect(screen.queryByText("Read file 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Read file 2")).not.toBeInTheDocument();
    expect(screen.getByText("Read file 3")).toBeInTheDocument();
    expect(screen.getByText("Read file 10")).toBeInTheDocument();
    expect(viewport.className).not.toContain("overflow-y-auto");

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));

    expect(screen.getByText("Read file 1")).toBeInTheDocument();
    expect(screen.getByText("Read file 10")).toBeInTheDocument();
    expect(viewport.className).toContain("overflow-y-auto");
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(screen.queryByText("Read file 1")).not.toBeInTheDocument();
    expect(screen.getByText("Read file 10")).toBeInTheDocument();
    expect(viewport.className).not.toContain("overflow-y-auto");
  });

  it("renders every row inline when the group fits under the cap", () => {
    const threadId = "thread-1";
    const items = Array.from({ length: 6 }, (_, index) =>
      makeToolItem(`tool-${index + 1}`, `Read file ${index + 1}`),
    );
    seedThread(threadId, items);

    const view = renderToolCallGroup(
      threadId,
      items.map((item) => item.id),
    );
    const viewport = getViewport(view.container);

    for (let i = 1; i <= 6; i += 1) {
      expect(screen.getByText(`Read file ${i}`)).toBeInTheDocument();
    }
    expect(viewport.className).not.toContain("overflow-y-auto");
    expect(screen.queryByRole("button", { name: "Show all" })).not.toBeInTheDocument();
  });

  it("colors file-change diff summary counts and hides zero values", () => {
    const threadId = "thread-1";
    const items = [
      makeFileChangeItem("file-1", { added: 4, removed: 2 }),
      makeFileChangeItem("file-2", { added: 5, removed: 0 }),
    ];
    seedThread(threadId, items);

    renderToolCallGroup(
      threadId,
      items.map((item) => item.id),
    );

    expect(screen.getByText("+4")).toHaveClass("text-success");
    expect(screen.getByText("-2")).toHaveClass("text-danger");
    expect(screen.getByText("+5")).toHaveClass("text-success");
    expect(screen.queryByText("-0")).not.toBeInTheDocument();
  });

  it("renders file-change diffs directly instead of args/result sections", async () => {
    const threadId = "thread-1";
    const item = makeFileChangeItem("file-1");
    seedThread(threadId, [item]);

    renderToolCallGroup(threadId, [item.id]);
    fireEvent.click(screen.getByText("src/foo.ts"));

    await waitFor(() => {
      expect(document.body).toHaveTextContent(/old/);
      expect(document.body).toHaveTextContent(/new/);
    });
    expect(screen.queryByText("args")).not.toBeInTheDocument();
    expect(screen.queryByText("result")).not.toBeInTheDocument();
  });

  it("prefers a synthesized diff over non-diff streamed status text", async () => {
    const threadId = "thread-1";
    const item = makeReplacementFileChangeItem("file-2");
    seedThread(threadId, [item]);

    renderToolCallGroup(threadId, [item.id]);
    fireEvent.click(screen.getByText("src/foo.ts"));

    await waitFor(() => {
      expect(document.body).toHaveTextContent(/old value/);
      expect(document.body).toHaveTextContent(/new value/);
    });
    expect(screen.queryByText("Edit applied successfully.")).not.toBeInTheDocument();
    expect(screen.queryByText("args")).not.toBeInTheDocument();
    expect(screen.queryByText("result")).not.toBeInTheDocument();
  });
});

function renderToolCallGroup(threadId: string, itemIds: readonly string[]) {
  return render(
    <AppProvider>
      <ToolCallGroup threadId={threadId} itemIds={itemIds} isLive />
    </AppProvider>,
  );
}

function seedThread(threadId: string, items: readonly RuntimeChatItem[]) {
  useAppStore.setState({
    runtimeItemIdsByThread: { [threadId]: items.map((item) => item.id) },
    runtimeItemsByIdByThread: {
      [threadId]: Object.fromEntries(items.map((item) => [item.id, item])),
    },
    runtimeStructuralVersionByThread: { [threadId]: items.length },
  });
}

function makeToolItem(id: string, name: string): RuntimeChatItem {
  return {
    id,
    type: "tool_call",
    state: "completed",
    payload: { name, status: "success" },
    streams: {},
  };
}

function makeFileChangeItem(
  id: string,
  diffSummary: { added: number; removed: number } = { added: 1, removed: 1 },
): RuntimeChatItem {
  return {
    id,
    type: "file_change",
    state: "completed",
    payload: {
      path: "src/foo.ts",
      changeKind: "edit",
      diffSummary,
      args: [
        "*** Begin Patch",
        "*** Update File: src/foo.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      result: {
        detailedContent: [
          "diff --git a/src/foo.ts b/src/foo.ts",
          "--- a/src/foo.ts",
          "+++ b/src/foo.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new",
          "",
        ].join("\n"),
      },
    },
    streams: {},
  };
}

function makeReplacementFileChangeItem(id: string): RuntimeChatItem {
  return {
    id,
    type: "file_change",
    state: "completed",
    payload: {
      path: "src/foo.ts",
      changeKind: "edit",
      diffSummary: { added: 1, removed: 1 },
      args: {
        filePath: "src/foo.ts",
        oldString: "old value",
        newString: "new value",
      },
      result: { content: "Edit applied successfully." },
    },
    streams: { file_change_output: "Edit applied successfully." },
  };
}

function getViewport(container: HTMLElement): HTMLDivElement {
  const element = container.querySelector(".lightcode-tool-call-group-viewport");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error("missing tool call group viewport");
  }
  return element;
}
