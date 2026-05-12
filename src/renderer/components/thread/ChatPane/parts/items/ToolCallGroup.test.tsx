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

  it("renders changes-array edits as diffs instead of raw args/result JSON", async () => {
    const threadId = "thread-1";
    const item = makeChangesArrayFileChangeItem("file-changes-array-edit", "edit");
    seedThread(threadId, [item]);

    renderToolCallGroup(threadId, [item.id]);

    expect(screen.getByText("+3")).toHaveClass("text-success");
    fireEvent.click(screen.getByText("chatPaneSelectors.ts"));

    await waitFor(() => {
      expect(document.body).toHaveTextContent(/canShareRuntimeToolGroup/);
      expect(document.body).toHaveTextContent(/groupIds\.push/);
    });
    expect(screen.queryByText("args")).not.toBeInTheDocument();
    expect(screen.queryByText("result")).not.toBeInTheDocument();
  });

  it("renders changes-array creates as highlighted file content", async () => {
    const threadId = "thread-1";
    const item = makeChangesArrayFileChangeItem("file-changes-array-create", "create");
    seedThread(threadId, [item]);

    renderToolCallGroup(threadId, [item.id]);

    expect(screen.getByText("+2")).toHaveClass("text-success");
    fireEvent.click(screen.getByText("runtimeToolGrouping.ts"));

    await waitFor(() => {
      expect(document.body).toHaveTextContent(/const EDIT_TOOL_NAMES/);
      expect(document.body).toHaveTextContent(/export function canShareRuntimeToolGroup/);
    });
    expect(screen.queryByText('"changes"')).not.toBeInTheDocument();
    expect(screen.queryByText("args")).not.toBeInTheDocument();
    expect(screen.queryByText("result")).not.toBeInTheDocument();
  });

  it("uses command intent titles inside grouped command rows", () => {
    const threadId = "thread-1";
    const items = [
      makeCommandItem("cmd-1", "sed -n '1,24p' src/supervisor/runtime.test.ts"),
      makeCommandItem("cmd-2", "find node_modules/.pnpm -maxdepth 4 -type f -name 'vitest.mjs'"),
      makeCommandItem("cmd-3", "git diff -- src/supervisor/runtime.ts"),
      makeCommandItem("cmd-4", "pnpm run test"),
      makeCommandItem("cmd-5", "pnpm install --prod=false"),
    ];
    seedThread(threadId, items);

    renderToolCallGroup(
      threadId,
      items.map((item) => item.id),
    );

    expect(screen.getByText("View lines 1-24: src/supervisor/runtime.test.ts")).toBeInTheDocument();
    expect(
      screen.getByText('Search files: "vitest.mjs" in node_modules/.pnpm'),
    ).toBeInTheDocument();
    expect(screen.getByText("Git: git diff -- src/supervisor/runtime.ts")).toBeInTheDocument();
    expect(screen.getByText("Check: pnpm run test")).toBeInTheDocument();
    expect(screen.getByText("Install packages: pnpm install")).toBeInTheDocument();
  });

  it("categorizes persisted compacted tool summaries by their labels", () => {
    const threadId = "thread-1";
    const items = [
      makeToolItem("summary-1", "7 commands"),
      makeToolItem("summary-2", "5 commands"),
      makeToolItem("summary-3", "4 edits"),
    ];
    seedThread(threadId, items);

    renderToolCallGroup(
      threadId,
      items.map((item) => item.id),
    );

    expect(screen.getByText("2 commands")).toBeInTheDocument();
    expect(screen.getByText("1 edit")).toBeInTheDocument();
  });

  it("categorizes sub-agent tools as commands", () => {
    const threadId = "thread-1";
    const items = [makeAgentItem("agent-1")];
    seedThread(threadId, items);

    renderToolCallGroup(threadId, [items[0]!.id]);

    expect(screen.getByText("1 command")).toBeInTheDocument();
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

function makeCommandItem(id: string, command: string): RuntimeChatItem {
  return {
    id,
    type: "command_execution",
    state: "completed",
    payload: { command, exitCode: 0 },
    streams: {},
  };
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

function makeAgentItem(id: string): RuntimeChatItem {
  return {
    id,
    type: "tool_call",
    state: "completed",
    payload: {
      name: "Agent",
      status: "success",
      args: { description: "Review code", subagent_type: "general-purpose" },
    },
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

function makeChangesArrayFileChangeItem(
  id: string,
  changeKind: "create" | "edit",
): RuntimeChatItem {
  const path =
    changeKind === "create"
      ? "/Users/serhiivecherenko/work/lightcode/src/renderer/state/runtimeToolGrouping.ts"
      : "/Users/serhiivecherenko/work/lightcode/src/renderer/components/thread/ChatPane/chatPaneSelectors.ts";
  const diff =
    changeKind === "create"
      ? [
          "@@ -0,0 +1,2 @@",
          '+const EDIT_TOOL_NAMES = new Set(["Edit", "Write"]);',
          "+export function canShareRuntimeToolGroup() { return true; }",
          "",
        ].join("\n")
      : [
          "@@ -6,2 +6,3 @@",
          ' import type { ToolCallPayload } from "@/shared/contracts";',
          '+import { canShareRuntimeToolGroup } from "@/renderer/state/runtimeToolGrouping";',
          "+if (!canShareRuntimeToolGroup(item, next)) {",
          "+  break;",
          " groupIds.push(nextId);",
          "",
        ].join("\n");

  return {
    id,
    type: "file_change",
    state: "completed",
    payload: {
      path,
      changeKind,
      args: {
        changes: [
          {
            path,
            kind: {
              type: changeKind === "create" ? "add" : "update",
              move_path: null,
            },
            diff,
          },
        ],
      },
      result: {
        changes: [
          {
            path,
            kind: {
              type: changeKind === "create" ? "add" : "update",
              move_path: null,
            },
            diff,
          },
        ],
      },
    },
    streams: {},
  };
}

function getViewport(container: HTMLElement): HTMLDivElement {
  const element = container.querySelector(".lightcode-tool-call-group-viewport");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error("missing tool call group viewport");
  }
  return element;
}
