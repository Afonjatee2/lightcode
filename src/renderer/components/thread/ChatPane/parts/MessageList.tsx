import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Surface } from "@heroui/react";
import type { ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import type { CompletedTurnRecord } from "@/renderer/state/slices/runtimeEventSlice";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import {
  CheckpointRevertButton,
  DEFAULT_CHECKPOINT_GUARD,
  RevertCheckpointDialog,
  type CheckpointGuard,
  type RevertScope,
} from "./CheckpointRevertControls";
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
import { chatMessageSurfaceClass } from "./items/chatMessageSurface";

interface MessageListProps {
  threadId: string;
  entries: readonly ChatTimelineEntry[];
  scrollElement: HTMLDivElement | null;
  /**
   * Reverting is transcript-local today. Disable it while a turn is live so
   * late provider events cannot append onto a truncated timeline.
   */
  canRevertCheckpoints?: boolean;
  checkpointGuard?: CheckpointGuard;
  projectLocation?: ProjectLocation | undefined;
  /**
   * If set, the inline "Worked for X" indicator anchored to this item id is
   * suppressed because the parent tail loader is already showing it (matches
   * the most recent completed turn while the thread is idle).
   */
  suppressInlineTurnAnchorId?: string | null;
}

const CHAT_TRANSCRIPT_OVERSCAN = 8;
const DEFAULT_ROW_ESTIMATE_PX = 96;
const SKIP_REVERT_CONFIRM_PREF_KEY = "lightcode-chat-checkpoint-revert-skip-confirm";

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
  canRevertCheckpoints = true,
  checkpointGuard,
  projectLocation,
  suppressInlineTurnAnchorId = null,
}: MessageListProps) {
  const hasItems = entries.length > 0;
  const parentActions = useChatPaneActions();
  const rowElementsRef = useRef(new Map<number, HTMLDivElement>());
  const [measureEpoch, setMeasureEpoch] = useState(0);
  const [pendingRevertItemId, setPendingRevertItemId] = useState<string | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [revertScope, setRevertScope] = useState<RevertScope>("transcript");
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
    // Adjust scroll only when the resized row is fully above the viewport.
    // This is what keeps visible content anchored as overscan rows replace
    // their estimated heights with real measurements — critical for smooth
    // upward scrolling, where rough estimates above the viewport otherwise
    // shift visible rows downward and look like jumps. Do NOT suppress this
    // during backward scrolling: the compensation IS the smooth scroll.
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, _instance) => {
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

  const performRevert = useCallback(
    async (itemId: string, scope: RevertScope) => {
      if (scope === "files" && projectLocation) {
        await readBridge().restoreFileCheckpoint({
          threadId,
          checkpointItemId: itemId,
          projectLocation,
        });
      }
      useAppStore.getState().truncateThreadRuntimeAfter(threadId, itemId);
      parentActions?.onContentHeightChange();
    },
    [parentActions, projectLocation, threadId],
  );

  const requestRevert = useCallback(
    (itemId: string) => {
      if (localStorage.getItem(SKIP_REVERT_CONFIRM_PREF_KEY) === "1") {
        void performRevert(itemId, "transcript");
        return;
      }
      setDontAskAgain(false);
      setRevertScope("transcript");
      setPendingRevertItemId(itemId);
    },
    [performRevert],
  );

  const confirmRevert = useCallback(() => {
    if (!pendingRevertItemId) return;
    if (dontAskAgain) {
      localStorage.setItem(SKIP_REVERT_CONFIRM_PREF_KEY, "1");
    }
    void performRevert(pendingRevertItemId, revertScope);
    setPendingRevertItemId(null);
    setDontAskAgain(false);
    setRevertScope("transcript");
  }, [dontAskAgain, pendingRevertItemId, performRevert, revertScope]);

  const pendingCheckpoint = useAppStore((state) =>
    pendingRevertItemId
      ? state.fileCheckpointsByThread[threadId]?.[pendingRevertItemId]
      : undefined,
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
                  canRevertCheckpoints={canRevertCheckpoints}
                  onRequestRevert={requestRevert}
                />
              );
            })}
          </div>
        </div>
      </div>
      <RevertCheckpointDialog
        isOpen={pendingRevertItemId !== null}
        dontAskAgain={dontAskAgain}
        revertScope={revertScope}
        checkpointGuard={checkpointGuard ?? DEFAULT_CHECKPOINT_GUARD}
        fileCheckpoint={pendingCheckpoint}
        canRestoreFiles={projectLocation !== undefined && pendingCheckpoint !== undefined}
        onDontAskAgainChange={setDontAskAgain}
        onRevertScopeChange={setRevertScope}
        onClose={() => {
          setPendingRevertItemId(null);
          setDontAskAgain(false);
          setRevertScope("transcript");
        }}
        onConfirm={confirmRevert}
      />
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
  canRevertCheckpoints: boolean;
  onRequestRevert: (itemId: string) => void;
};

const VirtualChatListRow = memo(function VirtualChatListRow({
  threadId,
  entry,
  index,
  isLastEntry,
  measureElement,
  suppressInlineTurnAnchorId,
  canRevertCheckpoints,
  onRequestRevert,
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
  const checkpointRevertItemId = useAppStore((state) => {
    if (!canRevertCheckpoints || entry.kind !== "item") return null;
    const itemIds = state.runtimeItemIdsByThread[threadId];
    const itemsById = state.runtimeItemsByIdByThread[threadId];
    if (!itemIds || !itemsById) return null;
    if (itemsById[entry.id]?.type !== "user_message") return null;
    return findCheckpointBeforeUserMessage(itemIds, itemsById, entry.id);
  });
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
      <div className={`group/checkpoint relative w-full pb-1 ${showTurnGap ? "pt-3" : ""}`}>
        <div className="relative">
          <ChatItemRow
            threadId={threadId}
            entry={entry}
            isLastEntry={isLastEntry}
            checkpointRevertControl={
              checkpointRevertItemId ? (
                <CheckpointRevertButton
                  itemId={checkpointRevertItemId}
                  onRequestRevert={onRequestRevert}
                />
              ) : null
            }
          />
        </div>
        {showInlineTurn ? (
          <CompletedTurnIndicator threadId={threadId} record={completedTurn} />
        ) : null}
      </div>
    </div>
  );
});

function CompletedTurnIndicator({ record }: { threadId: string; record: CompletedTurnRecord }) {
  const elapsedSeconds = Math.max(0, Math.floor((record.endedAt - record.startedAt) / 1000));
  if (elapsedSeconds < 1) return null;
  return (
    <Surface variant="transparent" className={chatMessageSurfaceClass}>
      <div className="flex flex-col gap-0.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
        {elapsedSeconds >= 1 ? (
          <span className="text-muted">Worked for {formatElapsed(elapsedSeconds)}</span>
        ) : null}
      </div>
    </Surface>
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

function findCheckpointBeforeUserMessage(
  itemIds: readonly string[],
  itemsById: ReturnType<typeof useAppStore.getState>["runtimeItemsByIdByThread"][string],
  userItemId: string,
): string | null {
  const userIndex = itemIds.indexOf(userItemId);
  if (userIndex <= 0) return null;

  for (let idx = userIndex - 1; idx >= 0; idx -= 1) {
    const itemId = itemIds[idx]!;
    if (itemsById[itemId]?.type === "assistant_message") return itemId;
  }

  return null;
}
