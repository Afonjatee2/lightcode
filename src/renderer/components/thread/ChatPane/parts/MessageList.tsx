import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "@/renderer/state/appStore";
import type { CompletedTurnRecord } from "@/renderer/state/slices/runtimeEventSlice";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import { formatElapsed } from "../formatElapsed";
import {
  ChatPaneActionsContext,
  type ChatPaneActions,
  useChatPaneActions,
} from "../chatPaneActionsContext";
import {
  selectCompletedTurnForEntry,
  selectRuntimeItemById,
  type ChatTimelineEntry,
} from "../chatPaneSelectors";
import { ChatItemRow } from "./items/ChatItemRow";

interface MessageListProps {
  threadId: string;
  entries: readonly ChatTimelineEntry[];
  scrollElement: HTMLDivElement | null;
  /**
   * If set, the inline "Worked for X" indicator anchored to this item id is
   * suppressed because the parent tail loader is already showing it (matches
   * the most recent completed turn while the thread is idle).
   */
  suppressInlineTurnAnchorId?: string | null;
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
  scrollElement,
  suppressInlineTurnAnchorId = null,
}: MessageListProps) {
  const hasItems = entries.length > 0;
  const parentActions = useChatPaneActions();
  const rowElementsRef = useRef(new Map<number, HTMLDivElement>());
  const [measureEpoch, setMeasureEpoch] = useState(0);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: useCallback(() => scrollElement, [scrollElement]),
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

  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
      if (!scrollElement) return false;
      return item.start + item.size <= scrollElement.scrollTop;
    };
    return () => {
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [scrollElement, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const firstVisibleStart = virtualItems[0]?.start ?? 0;

  // The "live tail" index drives the auto-expand on `ToolCallGroup`. Trailing
  // empty/in-flight reasoning items don't count: an agent emitting a reasoning
  // bracket between tool calls would otherwise collapse the group prematurely
  // (and it often completes empty and gets dropped, causing a flicker). Only
  // once reasoning actually has text — or any other item arrives — does the
  // previous group lose its live status.
  const liveTailSelector = useCallback(
    (state: AppStoreState) => computeLiveTailIndex(state, threadId, entries),
    [entries, threadId],
  );
  const lastLiveIndex = useAppStore(liveTailSelector);

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
                  isLastEntry={virtualRow.index === lastLiveIndex}
                  measureElement={measureRowElement}
                  suppressInlineTurnAnchorId={suppressInlineTurnAnchorId}
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
  isLastEntry: boolean;
  measureElement: (index: number, element: HTMLDivElement | null) => void;
  suppressInlineTurnAnchorId: string | null;
};

const VirtualChatListRow = memo(function VirtualChatListRow({
  threadId,
  entry,
  index,
  isLastEntry,
  measureElement,
  suppressInlineTurnAnchorId,
}: VirtualChatListRowProps) {
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      measureElement(index, element);
    },
    [index, measureElement],
  );
  const isUserMessage = useAppStore((state) =>
    entry.kind === "item"
      ? state.runtimeItemsByIdByThread[threadId]?.[entry.id]?.type === "user_message"
      : false,
  );
  const showTurnGap = isUserMessage && index > 0;
  const completedTurn = useAppStore((state) => selectCompletedTurnForEntry(state, threadId, entry));
  const showInlineTurn =
    completedTurn !== undefined &&
    completedTurn.anchorItemId !== null &&
    completedTurn.anchorItemId !== suppressInlineTurnAnchorId;

  return (
    <div
      ref={ref}
      data-chat-virtual-row="true"
      data-index={index}
      data-item-id={entry.id}
      className="w-full"
    >
      <div className={`w-full pb-1 ${showTurnGap ? "pt-3" : ""}`}>
        <ChatItemRow threadId={threadId} entry={entry} isLastEntry={isLastEntry} />
        {showInlineTurn ? <CompletedTurnIndicator record={completedTurn} /> : null}
      </div>
    </div>
  );
});

function CompletedTurnIndicator({ record }: { record: CompletedTurnRecord }) {
  const elapsedSeconds = Math.max(0, Math.floor((record.endedAt - record.startedAt) / 1000));
  if (elapsedSeconds < 1) return null;
  return (
    <div className="px-1 pt-1.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
      <span className="text-muted">Worked for {formatElapsed(elapsedSeconds)}</span>
    </div>
  );
}

function computeLiveTailIndex(
  state: AppStoreState,
  threadId: string,
  entries: readonly ChatTimelineEntry[],
): number {
  const items = state.runtimeItemsByIdByThread[threadId];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (entry.kind === "tool_call_group") return i;
    const item = items?.[entry.id];
    if (item?.type === "reasoning" && !(item.streams.reasoning_text ?? "").trim()) continue;
    return i;
  }
  return -1;
}

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
