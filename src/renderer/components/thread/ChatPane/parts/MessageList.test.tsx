import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  shouldAdjustScrollPositionOnItemSizeChange?: (
    item: { start: number; size: number },
    delta: number,
    instance: unknown,
  ) => boolean;
};

type MockVirtualizerOptions = {
  count: number;
  getScrollElement: () => Element | null;
  useFlushSync?: boolean;
};

const {
  useVirtualizerMock,
  measureMock,
  measureElementMock,
  getVirtualItemsMock,
  getTotalSizeMock,
} = vi.hoisted(() => ({
  useVirtualizerMock: vi.fn<(options: MockVirtualizerOptions) => MockVirtualizer>(),
  measureMock: vi.fn<() => void>(),
  measureElementMock: vi.fn<(element: HTMLDivElement | null) => void>(),
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
    });
  });

  it("renders only the visible virtual rows", () => {
    const scrollRef = { current: document.createElement("div") };
    const actions = {
      openProjectRelativePath: vi.fn<(path: string) => void>(),
      onContentHeightChange: vi.fn<() => void>(),
    };

    render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollRef={scrollRef}
        />
      </ChatPaneActionsContext.Provider>,
    );

    expect(useVirtualizerMock).toHaveBeenCalledOnce();
    const virtualizerOptions = useVirtualizerMock.mock.calls[0]![0];
    expect(virtualizerOptions.count).toBe(4);
    expect(virtualizerOptions.getScrollElement()).toBe(scrollRef.current);
    expect(virtualizerOptions.useFlushSync).toBe(false);
    expect(screen.queryByText("item-1")).not.toBeInTheDocument();
    expect(screen.getByText("item-2")).toBeInTheDocument();
    expect(screen.getByText("item-3")).toBeInTheDocument();
    expect(screen.queryByText("item-4")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-chat-virtual-row='true']")).toHaveLength(2);
    expect(document.querySelector("[data-chat-virtual-block='true']")).toHaveStyle({
      transform: "translateY(96px)",
    });
    expect(document.querySelector("[data-item-id='item-2']")).not.toHaveAttribute("style");
  });

  it("only adjusts scroll for measured rows fully above the viewport", () => {
    const scrollRef = { current: document.createElement("div") };
    scrollRef.current.scrollTop = 160;

    render(
      <MessageList
        threadId="thread-1"
        entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
        scrollRef={scrollRef}
      />,
    );

    const virtualizer = useVirtualizerMock.mock.results[0]!.value;
    const shouldAdjust = virtualizer.shouldAdjustScrollPositionOnItemSizeChange!;

    expect(shouldAdjust({ start: 0, size: 80 }, 40, {})).toBe(true);
    expect(shouldAdjust({ start: 96, size: 100 }, 40, {})).toBe(false);
  });

  it("reports virtual total size changes to parent actions", () => {
    const onContentHeightChange = vi.fn<() => void>();
    const actions = {
      openProjectRelativePath: vi.fn<(path: string) => void>(),
      onContentHeightChange,
    };
    const scrollRef = { current: document.createElement("div") };
    const { rerender } = render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollRef={scrollRef}
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
          scrollRef={scrollRef}
        />
      </ChatPaneActionsContext.Provider>,
    );

    expect(onContentHeightChange).toHaveBeenCalledTimes(2);
  });

  it("delegates height change to parent actions without calling virtualizer.measure()", () => {
    const onContentHeightChange = vi.fn<() => void>();
    const actions = {
      openProjectRelativePath: vi.fn<(path: string) => void>(),
      onContentHeightChange,
    };

    render(
      <ChatPaneActionsContext.Provider value={actions}>
        <MessageList
          threadId="thread-1"
          entries={makeEntries(["item-1", "item-2", "item-3", "item-4"])}
          scrollRef={{ current: document.createElement("div") }}
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
