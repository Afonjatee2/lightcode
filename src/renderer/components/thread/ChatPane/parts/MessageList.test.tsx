import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";
import { ChatPaneActionsContext, useChatPaneActions } from "../chatPaneActionsContext";
import { MessageList } from "./MessageList";

type MockVirtualRow = {
  key: string;
  index: number;
  start: number;
};

type MockVirtualizer = {
  getVirtualItems: () => MockVirtualRow[];
  getTotalSize: () => number;
  measure: () => void;
  measureElement: (element: HTMLDivElement | null) => void;
  scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void;
  shouldAdjustScrollPositionOnItemSizeChange?: (
    item: { start: number; size: number },
    delta: number,
    instance: { isScrolling: boolean; scrollDirection: "forward" | "backward" | null },
  ) => boolean;
};

type MockVirtualizerOptions = {
  count: number;
  getScrollElement: () => Element | null;
  useFlushSync?: boolean;
  useAnimationFrameWithResizeObserver?: boolean;
};

const {
  useVirtualizerMock,
  measureMock,
  measureElementMock,
  scrollToIndexMock,
  getVirtualItemsMock,
  getTotalSizeMock,
} = vi.hoisted(() => ({
  useVirtualizerMock: vi.fn<(options: MockVirtualizerOptions) => MockVirtualizer>(),
  measureMock: vi.fn<() => void>(),
  measureElementMock: vi.fn<(element: HTMLDivElement | null) => void>(),
  scrollToIndexMock:
    vi.fn<(index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void>(),
  getVirtualItemsMock: vi.fn<() => MockVirtualRow[]>(),
  getTotalSizeMock: vi.fn<() => number>(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: useVirtualizerMock,
}));

vi.mock("./items/ChatItemRow", () => ({
  ChatItemRow: (props: { entry: { id: string } }) => {
    const actions = useChatPaneActions();
    return (
      <button type="button" onClick={() => actions?.onContentHeightChange()}>
        {props.entry.id}
      </button>
    );
  },
}));

describe("MessageList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState((state) => ({
      ...state,
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
      runtimeItemChildrenByParentByThread: {},
      runtimeCompletedTurnsByThread: {},
    }));
    getVirtualItemsMock.mockReturnValue([
      { key: "row-2", index: 1, start: 96 },
      { key: "row-3", index: 2, start: 192 },
    ]);
    getTotalSizeMock.mockReturnValue(384);
    useVirtualizerMock.mockReturnValue({
      getVirtualItems: getVirtualItemsMock,
      getTotalSize: getTotalSizeMock,
      measure: measureMock,
      measureElement: measureElementMock,
      scrollToIndex: scrollToIndexMock,
    });
  });

  it("renders only the visible virtual rows", () => {
    const scrollElement = document.createElement("div");
    const actions = {
      openProjectRelativePath: vi.fn<(path: string, lineNumber?: number) => void>(),
      revealProjectFolderInTree: vi.fn<(path: string) => void>(),
      showProjectEntryInExplorer: vi.fn<(path: string) => void>(),
      onContentHeightChange: vi.fn<() => void>(),
      projectLocation: { kind: "windows" as const, path: "C:\\repo" },
      projectRootNames: new Set<string>(),
    };

    const threadId = "thread-1";
    useAppStore.getState().applyRuntimeEvent(threadId, {
      type: "item.started",
      threadId,
      itemId: "item-4",
      itemType: "assistant_message",
    });

    render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId={threadId}
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollElement={scrollElement}
        />
      </ChatPaneActionsContext.Provider>,
    );

    expect(useVirtualizerMock).toHaveBeenCalledOnce();
    const virtualizerOptions = useVirtualizerMock.mock.calls[0]![0];
    expect(virtualizerOptions.count).toBe(4);
    expect(virtualizerOptions.getScrollElement()).toBe(scrollElement);
    expect(virtualizerOptions.useFlushSync).toBe(true);
    expect(virtualizerOptions.useAnimationFrameWithResizeObserver).toBe(true);
    expect(screen.queryByText("item-1")).not.toBeInTheDocument();
    expect(screen.getByText("item-2")).toBeInTheDocument();
    expect(screen.getByText("item-3")).toBeInTheDocument();
    expect(screen.queryByText("item-4")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-chat-virtual-row='true']")).toHaveLength(2);
    const virtualSizeBox = document.querySelector("[data-chat-virtual-size-box='true']");
    expect(virtualSizeBox).toHaveClass("overflow-hidden");
    expect(virtualSizeBox).toHaveAttribute("data-bottom-fade-visible", "true");
    expect(virtualSizeBox).toHaveStyle({
      height: "384px",
      maskImage:
        "linear-gradient(to bottom, black calc(100% - 14px), rgb(0 0 0 / var(--lc-chat-bottom-mask-end-alpha, 0)))",
    });
    expect(document.querySelector("[data-chat-virtual-block='true']")).toHaveStyle({
      transform: "translateY(96px)",
    });
    expect(document.querySelector("[data-item-id='item-2']")).not.toHaveAttribute("style");
  });

  it("only adjusts scroll for measured rows fully above the viewport", () => {
    const scrollElement = document.createElement("div");
    scrollElement.scrollTop = 160;

    render(
      <MessageList
        threadId="thread-1"
        entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
        scrollElement={scrollElement}
      />,
    );

    const virtualizer = useVirtualizerMock.mock.results[0]!.value;
    const shouldAdjust = virtualizer.shouldAdjustScrollPositionOnItemSizeChange!;

    const idleVirtualizer = { isScrolling: false, scrollDirection: null } as const;
    expect(shouldAdjust({ start: 0, size: 80 }, 40, idleVirtualizer)).toBe(true);
    expect(shouldAdjust({ start: 96, size: 100 }, 40, idleVirtualizer)).toBe(false);
  });

  it("does not adjust scroll for rows above the viewport during active upward scroll", () => {
    const scrollElement = document.createElement("div");
    scrollElement.scrollTop = 160;

    render(
      <MessageList
        threadId="thread-1"
        entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
        scrollElement={scrollElement}
      />,
    );

    const virtualizer = useVirtualizerMock.mock.results[0]!.value;
    const shouldAdjust = virtualizer.shouldAdjustScrollPositionOnItemSizeChange!;

    expect(
      shouldAdjust({ start: 0, size: 80 }, -40, {
        isScrolling: true,
        scrollDirection: "backward",
      }),
    ).toBe(false);
  });

  it("does not adjust scroll for delayed row measurements after scrolling upward", () => {
    const scrollElement = document.createElement("div");
    scrollElement.scrollTop = 160;

    render(
      <MessageList
        threadId="thread-1"
        entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
        scrollElement={scrollElement}
      />,
    );

    const virtualizer = useVirtualizerMock.mock.results[0]!.value;
    const shouldAdjust = virtualizer.shouldAdjustScrollPositionOnItemSizeChange!;

    scrollElement.scrollTop = 120;
    fireEvent.scroll(scrollElement);

    expect(
      shouldAdjust({ start: 0, size: 80 }, -40, {
        isScrolling: false,
        scrollDirection: null,
      }),
    ).toBe(false);
  });

  it("adjusts streaming row height changes when bottom-sticky", () => {
    const scrollElement = document.createElement("div");
    scrollElement.scrollTop = 160;
    const actions = {
      openProjectRelativePath: vi.fn<(path: string, lineNumber?: number) => void>(),
      revealProjectFolderInTree: vi.fn<(path: string) => void>(),
      showProjectEntryInExplorer: vi.fn<(path: string) => void>(),
      onContentHeightChange: vi.fn<() => void>(),
      isStickToBottom: vi.fn<() => boolean>().mockReturnValue(true),
      projectLocation: { kind: "windows" as const, path: "C:\\repo" },
      projectRootNames: new Set<string>(),
    };

    render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollElement={scrollElement}
        />
      </ChatPaneActionsContext.Provider>,
    );

    const virtualizer = useVirtualizerMock.mock.results[0]!.value;
    const shouldAdjust = virtualizer.shouldAdjustScrollPositionOnItemSizeChange!;

    expect(
      shouldAdjust({ start: 96, size: 100 }, 24, {
        isScrolling: false,
        scrollDirection: null,
      }),
    ).toBe(true);
  });

  it("registers TanStack scrollToIndex as the bottom scroll handler", () => {
    const registerVirtualScrollToBottom = vi.fn<(handler: (() => void) | null) => void>();
    const actions = {
      openProjectRelativePath: vi.fn<(path: string, lineNumber?: number) => void>(),
      revealProjectFolderInTree: vi.fn<(path: string) => void>(),
      showProjectEntryInExplorer: vi.fn<(path: string) => void>(),
      onContentHeightChange: vi.fn<() => void>(),
      registerVirtualScrollToBottom,
      projectLocation: { kind: "windows" as const, path: "C:\\repo" },
      projectRootNames: new Set<string>(),
    };

    const { unmount } = render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollElement={document.createElement("div")}
        />
      </ChatPaneActionsContext.Provider>,
    );

    const handler = registerVirtualScrollToBottom.mock.calls.find(
      (call): call is [() => void] => typeof call[0] === "function",
    )?.[0];
    expect(handler).toEqual(expect.any(Function));

    handler?.();

    expect(scrollToIndexMock).toHaveBeenCalledWith(3, { align: "end" });

    unmount();

    expect(registerVirtualScrollToBottom).toHaveBeenLastCalledWith(null);
  });

  it("coalesces live row remeasurement to one animation frame while text streams", async () => {
    vi.useFakeTimers();
    const scrollElement = document.createElement("div");
    const threadId = "thread-1";
    useAppStore.getState().applyRuntimeEvent(threadId, {
      type: "item.started",
      threadId,
      itemId: "assistant-1",
      itemType: "assistant_message",
    });

    try {
      render(
        <MessageList
          threadId={threadId}
          entries={makeEntries(["item-1", "item-2", "assistant-1"])}
          scrollElement={scrollElement}
        />,
      );

      measureElementMock.mockClear();

      act(() => {
        useAppStore.getState().applyRuntimeEvent(threadId, {
          type: "content.delta",
          threadId,
          itemId: "assistant-1",
          stream: "assistant_text",
          delta: "new streamed line",
        });
        useAppStore.getState().applyRuntimeEvent(threadId, {
          type: "content.delta",
          threadId,
          itemId: "assistant-1",
          stream: "assistant_text",
          delta: " more text",
        });
      });

      expect(measureElementMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });

      expect(measureElementMock).toHaveBeenCalledTimes(1);
      expect(measureElementMock.mock.calls[0]?.[0]).toBe(
        document.querySelector("[data-item-id='assistant-1']"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the bottom overflow fade when the last timeline item is not an assistant message", () => {
    const threadId = "thread-1";
    useAppStore.getState().applyRuntimeEvent(threadId, {
      type: "item.started",
      threadId,
      itemId: "user-1",
      itemType: "user_message",
    });

    render(
      <MessageList
        threadId={threadId}
        entries={makeEntries(["assistant-1", "user-1"])}
        scrollElement={document.createElement("div")}
      />,
    );

    const virtualSizeBox = document.querySelector("[data-chat-virtual-size-box='true']");
    expect(virtualSizeBox).toHaveAttribute("data-bottom-fade-visible", "false");
    expect(
      (virtualSizeBox as HTMLElement).style.getPropertyValue("--lc-chat-bottom-mask-end-alpha"),
    ).toBe("1");
  });

  it("shows the bottom overflow fade only when the last timeline item is an assistant message", () => {
    const threadId = "thread-1";
    useAppStore.getState().applyRuntimeEvent(threadId, {
      type: "item.started",
      threadId,
      itemId: "assistant-1",
      itemType: "assistant_message",
    });

    render(
      <MessageList
        threadId={threadId}
        entries={makeEntries(["user-1", "assistant-1"])}
        scrollElement={document.createElement("div")}
      />,
    );

    const virtualSizeBox = document.querySelector("[data-chat-virtual-size-box='true']");
    expect(virtualSizeBox).toHaveAttribute("data-bottom-fade-visible", "true");
    expect(
      (virtualSizeBox as HTMLElement).style.getPropertyValue("--lc-chat-bottom-mask-end-alpha"),
    ).toBe("0");
  });

  it("hides the bottom overflow fade when the last timeline item is reasoning", () => {
    const threadId = "thread-1";
    useAppStore.getState().applyRuntimeEvent(threadId, {
      type: "item.started",
      threadId,
      itemId: "reasoning-1",
      itemType: "reasoning",
    });

    render(
      <MessageList
        threadId={threadId}
        entries={makeEntries(["assistant-1", "reasoning-1"])}
        scrollElement={document.createElement("div")}
      />,
    );

    const virtualSizeBox = document.querySelector("[data-chat-virtual-size-box='true']");
    expect(virtualSizeBox).toHaveAttribute("data-bottom-fade-visible", "false");
    expect(
      (virtualSizeBox as HTMLElement).style.getPropertyValue("--lc-chat-bottom-mask-end-alpha"),
    ).toBe("1");
  });

  it("reports virtual total size changes to parent actions", () => {
    const onContentHeightChange = vi.fn<() => void>();
    const actions = {
      openProjectRelativePath: vi.fn<(path: string, lineNumber?: number) => void>(),
      revealProjectFolderInTree: vi.fn<(path: string) => void>(),
      showProjectEntryInExplorer: vi.fn<(path: string) => void>(),
      onContentHeightChange,
      projectLocation: { kind: "windows" as const, path: "C:\\repo" },
      projectRootNames: new Set<string>(),
    };
    const scrollElement = document.createElement("div");
    const { rerender } = render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollElement={scrollElement}
        />
      </ChatPaneActionsContext.Provider>,
    );

    expect(onContentHeightChange).toHaveBeenCalledOnce();

    getTotalSizeMock.mockReturnValue(288);
    rerender(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollElement={scrollElement}
        />
      </ChatPaneActionsContext.Provider>,
    );

    expect(onContentHeightChange).toHaveBeenCalledTimes(2);
  });

  it("delegates height change to parent actions without calling virtualizer.measure()", () => {
    const onContentHeightChange = vi.fn<() => void>();
    const actions = {
      openProjectRelativePath: vi.fn<(path: string, lineNumber?: number) => void>(),
      revealProjectFolderInTree: vi.fn<(path: string) => void>(),
      showProjectEntryInExplorer: vi.fn<(path: string) => void>(),
      onContentHeightChange,
      projectLocation: { kind: "windows" as const, path: "C:\\repo" },
      projectRootNames: new Set<string>(),
    };

    render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollElement={document.createElement("div")}
        />
      </ChatPaneActionsContext.Provider>,
    );
    onContentHeightChange.mockClear();
    measureElementMock.mockClear();

    fireEvent.click(screen.getByText("item-2"));

    // The row-action path remeasures mounted rows with measureElement.
    // Calling virtualizer.measure() (no args) resets the entire size cache
    // which causes translateY gaps — so it must NOT be called here.
    expect(measureElementMock).toHaveBeenCalled();
    expect(measureMock).not.toHaveBeenCalled();
    expect(onContentHeightChange).toHaveBeenCalledOnce();
  });
});

function makeEntries(itemIds: readonly string[]) {
  return itemIds.map((id) => ({ kind: "item" as const, id }));
}
