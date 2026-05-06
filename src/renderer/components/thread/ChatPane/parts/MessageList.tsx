import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "@/renderer/state/appStore";
import {
  ChatPaneActionsContext,
  type ChatPaneActions,
  useChatPaneActions,
} from "../chatPaneActionsContext";
import { selectRuntimeItemById, type ChatTimelineEntry } from "../chatPaneSelectors";
import { ChatItemRow } from "./items/ChatItemRow";

interface MessageListProps {
  threadId: string;
  entries: readonly ChatTimelineEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
}

const CHAT_TRANSCRIPT_OVERSCAN = 8;
const DEFAULT_ROW_ESTIMATE_PX = 96;

/**
 * Virtualized chat transcript for the thread. Scroll lives on the parent pane,
 * while TanStack Virtual keeps the DOM limited to visible rows plus overscan.
 *
 * Explicit `memo` escape hatch: `ChatPane` re-renders for scroll pinning and
 * approval-card churn, but the transcript rows should stay isolated unless the
 * ordered `itemIds` actually change. React Compiler is the default strategy in
 * this repo; this is one of the cases where a manual boundary is still useful.
 */
export const MessageList = memo(function MessageList({
  threadId,
  entries,
  scrollRef,
}: MessageListProps) {
  const hasItems = entries.length > 0;
  const parentActions = useChatPaneActions();
  const rowElementsRef = useRef(new Map<number, HTMLDivElement>());
  const [measureEpoch, setMeasureEpoch] = useState(0);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: useCallback(() => scrollRef.current, [scrollRef]),
    estimateSize: useCallback(
      (index: number) => {
        const entry = entries[index];
        return estimateTimelineEntrySize(entry, threadId);
      },
      [entries, threadId],
    ),
    getItemKey: useCallback((index: number) => entries[index]?.id ?? index, [entries]),
    overscan: CHAT_TRANSCRIPT_OVERSCAN,
    // React 19 batches updates naturally; flushSync inside scroll events triggers
    // a "flushSync called from inside a lifecycle" warning. Disable it.
    useFlushSync: false,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const firstVisibleStart = virtualItems[0]?.start ?? 0;

  useLayoutEffect(() => {
    parentActions?.onContentHeightChange();
  }, [parentActions, totalSize]);

  useLayoutEffect(() => {
    if (measureEpoch === 0) return;
    for (const element of rowElementsRef.current.values()) {
      virtualizer.measureElement(element);
    }
  }, [measureEpoch, virtualizer]);

  const measureRowElement = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      if (element) {
        rowElementsRef.current.set(index, element);
      } else {
        rowElementsRef.current.delete(index);
      }
      virtualizer.measureElement(element);
    },
    [virtualizer],
  );

  // Row actions bubble up through ChatPaneActionsContext so disclosure rows can
  // notify the parent scroll controls when their height changes. We do NOT call
  // virtualizer.measure() here — that would reset the entire size cache back to
  // estimates and cause every row to jump. TanStack Virtual's measureElement ref
  // already attaches a ResizeObserver to each row wrapper; when a disclosure
  // expands or collapses the observer fires automatically and recalculates only
  // the affected row's position.
  const rowActions = useMemo<ChatPaneActions | null>(() => {
    if (!parentActions) return null;
    return {
      ...parentActions,
      onContentHeightChange: () => {
        setMeasureEpoch((epoch) => epoch + 1);
        parentActions.onContentHeightChange();
      },
    };
  }, [parentActions]);

  if (!hasItems) return null;

  return (
    <ChatPaneActionsContext.Provider value={rowActions}>
      <div className="mx-auto w-full max-w-[920px] pb-1">
        <div className="relative w-full" style={{ height: totalSize }}>
          <div
            data-chat-virtual-block="true"
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${firstVisibleStart}px)` }}
          >
            {virtualItems.map((virtualRow) => {
              const entry = entries[virtualRow.index];
              if (!entry) return null;
              return (
                <VirtualChatListRow
                  key={virtualRow.key}
                  threadId={threadId}
                  entry={entry}
                  index={virtualRow.index}
                  measureElement={measureRowElement}
                />
              );
            })}
          </div>
        </div>
      </div>
    </ChatPaneActionsContext.Provider>
  );
});

type VirtualChatListRowProps = {
  threadId: string;
  entry: ChatTimelineEntry;
  index: number;
  measureElement: (index: number, element: HTMLDivElement | null) => void;
};

const VirtualChatListRow = memo(function VirtualChatListRow({
  threadId,
  entry,
  index,
  measureElement,
}: VirtualChatListRowProps) {
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      measureElement(index, element);
    },
    [index, measureElement],
  );

  return (
    <div
      ref={ref}
      data-chat-virtual-row="true"
      data-index={index}
      data-item-id={entry.id}
      className="w-full"
    >
      <div className="w-full pb-1">
        <ChatItemRow threadId={threadId} entry={entry} />
      </div>
    </div>
  );
});

function estimateTimelineEntrySize(entry: ChatTimelineEntry | undefined, threadId: string): number {
  if (!entry) return DEFAULT_ROW_ESTIMATE_PX;
  if (entry.kind === "tool_call_group") return 64;
  return estimateRuntimeItemSize(selectRuntimeItemById(useAppStore.getState(), threadId, entry.id));
}

function estimateRuntimeItemSize(item: ReturnType<typeof selectRuntimeItemById>): number {
  if (!item) return DEFAULT_ROW_ESTIMATE_PX;
  switch (item.type) {
    case "assistant_message":
      return item.state === "completed" ? 168 : 208;
    case "user_message":
      return 88;
    case "reasoning":
      return item.state === "completed" ? 52 : 128;
    case "plan":
      return 128;
    case "command_execution":
    case "tool_call":
    case "file_change":
    case "web_search":
      return item.state === "completed" ? 56 : 132;
    case "error":
      return 80;
    default:
      return DEFAULT_ROW_ESTIMATE_PX;
  }
}
