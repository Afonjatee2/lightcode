import {
  forwardRef,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Surface } from "@heroui/react";
import { ArrowDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { isThreadTurnActive, type Thread } from "@/shared/contracts";
import { chatMessageSurfaceClass } from "./parts/items/chatMessageSurface";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { hydrateThreadRuntimeItems } from "@/renderer/state/chatRuntimePersister";
import {
  finalizeFileCheckpoint,
  hydrateFileCheckpoints,
} from "@/renderer/state/fileCheckpointActions";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useProjectRootNames } from "@/renderer/state/projectRootNamesStore";
import { useProjectTreeStore } from "@/renderer/state/projectTreeStore";
import {
  buildFileEditorContext,
  openFileInEditor,
  resolveWorktreeBranch,
} from "@/renderer/utils/gitHelpers";
import { ChatPaneActionsContext, type ChatPaneActions } from "./chatPaneActionsContext";
import {
  selectChatScrollAnchor,
  selectChatScrollAnchorForTimeline,
  selectVisibleThreadTimelineEntries,
  type ChatTimelineEntry,
} from "./chatPaneSelectors";
import { normalizeChatProjectPath } from "./chatPathUtils";
import { formatElapsed } from "./formatElapsed";
import { MessageList } from "./parts/MessageList";
import { SubAgentOverlay } from "./parts/items/SubAgentOverlay";

interface ChatPaneProps {
  thread: Thread;
  hiddenRuntimeItemId?: string | undefined;
  hiddenRuntimeItemIsLive?: boolean;
  hasSupplementaryContent?: boolean;
  layoutChangeToken?: string | null;
}

const BOTTOM_EPSILON_PX = 4;
const USER_SCROLL_INTENT_MS = 750;
const EMPTY_COMPLETED_TURNS: NonNullable<
  ReturnType<typeof useAppStore.getState>["runtimeCompletedTurnsByThread"][string]
> = [];
const EMPTY_ITEM_IDS: readonly string[] = [];
const EMPTY_FILE_CHECKPOINT_TURNS: NonNullable<
  ReturnType<typeof useAppStore.getState>["fileCheckpointTurnsByThread"][string]
> = {};

/**
 * Renderer-native chat surface for `presentationMode === "gui"` threads.
 *
 * Pulls canonical chat items from the Zustand `runtimeEventSlice` (populated
 * by IPC `thread-runtime-event` notifications) and renders them as a dense
 * vertical list. Pending approval / user-input requests are surfaced in the
 * composer (see `ThreadRuntimeRequestPanel`), not in the chat list.
 */
export function ChatPane(props: ChatPaneProps) {
  const {
    thread,
    hiddenRuntimeItemId,
    hiddenRuntimeItemIsLive = false,
    hasSupplementaryContent = false,
    layoutChangeToken,
  } = props;
  const { id: threadId, projectId, status, worktreePath, worktreeBranch } = thread;
  const scrollRef = useRef<HTMLDivElement>(null);
  // `scrollEl` mirrors `scrollRef.current` as React state so the virtualizer
  // in `MessageList` sees the element transition from `null` to mounted across
  // a real React render. Without this, after a drag-drop pane move the
  // virtualizer's internal observer-driven rerender can be lost and the chat
  // renders empty (with a scrollbar from `getTotalSize`) until the next state
  // change forces a recompute.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollContainer = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollEl;
    if (!el) return;

    const updateFades = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const topFade = Math.min(32, scrollTop);
      const bottomFade = Math.min(32, Math.max(0, scrollHeight - scrollTop - clientHeight));

      el.style.setProperty("--top-fade-size", `${topFade}px`);
      el.style.setProperty("--bottom-fade-size", `${bottomFade}px`);
    };

    updateFades();
    el.addEventListener("scroll", updateFades, { passive: true });

    // Re-check when the container or its content resizes.
    const observer = new ResizeObserver(updateFades);
    observer.observe(el);
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }

    return () => {
      el.removeEventListener("scroll", updateFades);
      observer.disconnect();
    };
  }, [scrollEl]);

  const scrollControlsRef = useRef<ChatScrollControlsHandle>(null);
  const timelineEntries = useAppStore(
    useShallow((s) => selectVisibleThreadTimelineEntries(s, threadId, hiddenRuntimeItemId)),
  );
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
  const branch = resolveWorktreeBranch(projectId, worktreePath ?? "", worktreeBranch);
  const targetContext = useMemo(
    () => (project ? buildFileEditorContext(project, worktreePath, branch) : null),
    [project, worktreePath, branch],
  );
  const projectRootNames = useProjectRootNames(targetContext?.projectLocation);

  const paneActions: ChatPaneActions | null = useMemo(() => {
    if (!project || !targetContext) return null;
    return {
      openProjectRelativePath: (path, lineNumber) => {
        void openFileInEditor(
          project,
          worktreePath,
          branch,
          normalizeChatProjectPath(path, targetContext.projectLocation),
          lineNumber,
        );
      },
      revealProjectFolderInTree: (path) => {
        const normalized = normalizeChatProjectPath(path, targetContext.projectLocation);
        const fileEditor = useFileEditorStore.getState();
        const currentRoot = fileEditor.rootContext;
        const isSameContext =
          currentRoot?.projectId === targetContext.projectId &&
          currentRoot?.worktreePath === targetContext.worktreePath;
        if (!isSameContext) {
          fileEditor.setRootContext(targetContext);
        }
        if (fileEditor.overlayMode !== "fullscreen") {
          fileEditor.setOverlayMode("modal");
        }
        const ancestors = collectPathAncestors(normalized);
        useProjectTreeStore.getState().expandMany(ancestors);
      },
      showProjectEntryInExplorer: (path) => {
        const normalized = normalizeChatProjectPath(path, targetContext.projectLocation);
        void readBridge().revealProjectEntry({
          projectLocation: targetContext.projectLocation,
          path: normalized,
        });
      },
      onContentHeightChange: () => scrollControlsRef.current?.onContentHeightChange(),
      projectLocation: targetContext.projectLocation,
      projectRootNames,
    };
  }, [project, targetContext, branch, worktreePath, projectRootNames]);

  useEffect(() => {
    void hydrateThreadRuntimeItems(threadId);
  }, [threadId]);

  useEffect(() => {
    if (!targetContext) return;
    void hydrateFileCheckpoints({
      threadId,
      projectLocation: targetContext.projectLocation,
    });
  }, [targetContext, threadId]);

  const completedTurns = useAppStore(
    (s) => s.runtimeCompletedTurnsByThread[threadId] ?? EMPTY_COMPLETED_TURNS,
  );
  const runtimeItemIds = useAppStore((s) => s.runtimeItemIdsByThread[threadId] ?? EMPTY_ITEM_IDS);
  const runtimeItemsById = useAppStore((s) => s.runtimeItemsByIdByThread[threadId]);
  const fileCheckpointTurns = useAppStore(
    (s) => s.fileCheckpointTurnsByThread[threadId] ?? EMPTY_FILE_CHECKPOINT_TURNS,
  );
  const finalizingFileCheckpointIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!targetContext || completedTurns.length === 0) return;
    for (const turn of completedTurns) {
      const checkpointItemId = turn.anchorItemId;
      if (!checkpointItemId) continue;
      if (fileCheckpointTurns[checkpointItemId]) continue;
      if (finalizingFileCheckpointIdsRef.current.has(checkpointItemId)) continue;
      const baseCheckpointItemId = findBaseCheckpointItemId(
        runtimeItemIds,
        runtimeItemsById,
        checkpointItemId,
      );
      if (!baseCheckpointItemId) continue;
      finalizingFileCheckpointIdsRef.current.add(checkpointItemId);
      void finalizeFileCheckpoint({
        threadId,
        checkpointItemId,
        baseCheckpointItemId,
        projectLocation: targetContext.projectLocation,
      }).finally(() => {
        finalizingFileCheckpointIdsRef.current.delete(checkpointItemId);
      });
    }
  }, [
    completedTurns,
    fileCheckpointTurns,
    runtimeItemIds,
    runtimeItemsById,
    targetContext,
    threadId,
  ]);

  const isEmpty = timelineEntries.length === 0 && !hasSupplementaryContent;
  const isLive = isThreadTurnActive(status);
  // Anchor on thread.status alone — gating on item state caused the loader to
  // disappear in the gap between an item flipping to `completed` and the next
  // `item.started` arriving, even though the runtime was still working the
  // turn. The pinned plan/budget item already advertises its own running
  // state, so suppress the tail when that's live to avoid double indicators.
  const turn = resolveTurnTiming(thread);
  const mostRecentCompletedTurnAnchor = useAppStore((s) => {
    if (isLive || turn?.endedAt == null) return null;
    const records = s.runtimeCompletedTurnsByThread[threadId];
    return records && records.length > 0
      ? (records[records.length - 1]?.anchorItemId ?? null)
      : null;
  });
  const completedTurnCanRenderInTail =
    !isLive &&
    turn?.endedAt != null &&
    isCompletedTurnAnchorAtTimelineTail(mostRecentCompletedTurnAnchor, timelineEntries);
  const showTailLoader = (isLive || completedTurnCanRenderInTail) && !hiddenRuntimeItemIsLive;
  const showEmptyHint = isEmpty && !isLive;
  // The tail loader displays the most recent completed turn's frozen elapsed
  // time when the thread is idle and no newer timeline row exists. Once an
  // optimistic next prompt is appended, keep the completed indicator inline at
  // its anchor so the prompt does not briefly occupy the old footer position.
  const suppressInlineTurnAnchorId = completedTurnCanRenderInTail
    ? mostRecentCompletedTurnAnchor
    : null;
  const checkpointGuard = useAppStore(
    useShallow((s) =>
      resolveCheckpointGuard({
        threads: s.threads,
        threadId,
        projectId,
        worktreePath,
      }),
    ),
  );

  return (
    <ChatPaneActionsContext.Provider value={paneActions}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <div
            ref={setScrollContainer}
            className="min-h-0 h-full overflow-y-auto [scrollbar-gutter:stable]"
            style={{
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black var(--top-fade-size, 0px), black calc(100% - var(--bottom-fade-size, 0px)), transparent)",
              maskImage:
                "linear-gradient(to bottom, transparent, black var(--top-fade-size, 0px), black calc(100% - var(--bottom-fade-size, 0px)), transparent)",
            }}
            onWheelCapture={(event) => {
              if (event.deltaY < 0) {
                scrollControlsRef.current?.markUserScrollIntent();
                scrollControlsRef.current?.disableStickToBottom();
              }
            }}
            onPointerDownCapture={() => {
              scrollControlsRef.current?.markUserScrollIntent();
            }}
            onKeyDownCapture={(event) => {
              if (isScrollNavigationKey(event.key)) {
                scrollControlsRef.current?.markUserScrollIntent();
              }
            }}
          >
            <div ref={contentRef} className="min-h-full pb-8">
              {isEmpty && !showTailLoader ? (
                showEmptyHint ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-foreground-muted">
                    <span>No messages yet</span>
                  </div>
                ) : null
              ) : (
                <>
                  <MessageList
                    key={threadId}
                    threadId={threadId}
                    entries={timelineEntries}
                    scrollElement={scrollEl}
                    suppressInlineTurnAnchorId={suppressInlineTurnAnchorId}
                    canRevertCheckpoints={!isLive}
                    checkpointGuard={checkpointGuard}
                    projectLocation={targetContext?.projectLocation}
                  />
                  {showTailLoader && turn ? <ChatTailLoader turn={turn} /> : null}
                </>
              )}
            </div>
          </div>
          <ChatScrollControls
            ref={scrollControlsRef}
            scrollRef={scrollRef}
            contentRef={contentRef}
            hiddenRuntimeItemId={hiddenRuntimeItemId}
            layoutChangeToken={layoutChangeToken}
            threadId={threadId}
            tailLoaderVisible={showTailLoader}
          />
          <SubAgentOverlay threadId={threadId} />
        </div>
      </div>
    </ChatPaneActionsContext.Provider>
  );
}

type ChatScrollControlsHandle = {
  disableStickToBottom(): void;
  markUserScrollIntent(): void;
  onContentHeightChange(): void;
};

const ChatScrollControls = forwardRef<
  ChatScrollControlsHandle,
  {
    scrollRef: React.RefObject<HTMLDivElement | null>;
    contentRef: React.RefObject<HTMLDivElement | null>;
    hiddenRuntimeItemId?: string | undefined;
    layoutChangeToken: string | null | undefined;
    threadId: string;
    tailLoaderVisible: boolean;
  }
>(function ChatScrollControls(props, ref) {
  const {
    scrollRef,
    contentRef,
    hiddenRuntimeItemId,
    layoutChangeToken,
    threadId,
    tailLoaderVisible,
  } = props;
  const scrollAnchor = useAppStore((s) =>
    hiddenRuntimeItemId
      ? selectChatScrollAnchorForTimeline(s, threadId, hiddenRuntimeItemId)
      : selectChatScrollAnchor(s, threadId),
  );
  const scrollToBottomToken = useAppStore((s) => s.chatScrollToBottomTokens[threadId] ?? 0);
  const initialLayoutChangeTokenRef = useRef(layoutChangeToken);
  const lastScrollTopRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const pinRafRef = useRef<number | null>(null);
  const layoutSyncRafRef = useRef<number | null>(null);
  const layoutSyncSecondRafRef = useRef<number | null>(null);
  const userScrollIntentUntilRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);

  function syncBottomStateFromLayout() {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = isElementAtBottom(el);
    if (isAtBottom) stickToBottomRef.current = true;
    setShowScrollDown(!stickToBottomRef.current && !isAtBottom);
  }

  function disableStickToBottom() {
    if (!stickToBottomRef.current) return;
    stickToBottomRef.current = false;
    const el = scrollRef.current;
    setShowScrollDown(!el || !isElementAtBottom(el));
  }

  function markUserScrollIntent() {
    userScrollIntentUntilRef.current = performance.now() + USER_SCROLL_INTENT_MS;
  }

  function hasRecentUserScrollIntent() {
    return performance.now() <= userScrollIntentUntilRef.current;
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
  }

  const syncLayoutNow = useEffectEvent(() => {
    if (stickToBottomRef.current) {
      scrollToBottom();
      return;
    }
    syncBottomStateFromLayout();
  });

  function cancelScheduledLayoutSync() {
    if (layoutSyncRafRef.current !== null) {
      cancelAnimationFrame(layoutSyncRafRef.current);
      layoutSyncRafRef.current = null;
    }
    if (layoutSyncSecondRafRef.current !== null) {
      cancelAnimationFrame(layoutSyncSecondRafRef.current);
      layoutSyncSecondRafRef.current = null;
    }
  }

  const syncLayoutNowAndAfterPaint = useEffectEvent(() => {
    syncLayoutNow();
    cancelScheduledLayoutSync();
    layoutSyncRafRef.current = requestAnimationFrame(() => {
      layoutSyncRafRef.current = null;
      syncLayoutNow();
      layoutSyncSecondRafRef.current = requestAnimationFrame(() => {
        layoutSyncSecondRafRef.current = null;
        syncLayoutNow();
      });
    });
  });

  useImperativeHandle(ref, () => ({
    disableStickToBottom,
    markUserScrollIntent,
    onContentHeightChange: syncLayoutNowAndAfterPaint,
  }));

  useLayoutEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll reset is keyed to thread changes; the helper reads refs/state setters only.
  }, [threadId]);

  // Preserve the bottom pin when the surrounding thread layout changes, but
  // keep the user's place if they already scrolled up.
  useLayoutEffect(() => {
    if (layoutChangeToken === initialLayoutChangeTokenRef.current) return;
    initialLayoutChangeTokenRef.current = layoutChangeToken;
    syncLayoutNowAndAfterPaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect is keyed to layout token changes; the helper reads refs/state setters only.
  }, [layoutChangeToken]);

  // Scroll to bottom when the composer signals a fresh user submission.
  // Token increments per submit, so consecutive sends still re-trigger.
  const initialScrollTokenRef = useRef(scrollToBottomToken);
  useEffect(() => {
    if (scrollToBottomToken === initialScrollTokenRef.current) return;
    initialScrollTokenRef.current = scrollToBottomToken;
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helper reads refs/state setters only.
  }, [scrollToBottomToken]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const prevScrollTop = lastScrollTopRef.current;
      const nextScrollTop = el.scrollTop;
      lastScrollTopRef.current = nextScrollTop;
      const isAtBottom = isElementAtBottom(el);
      // Only release sticky when the user actually moves away from the bottom.
      // Bare `!isAtBottom` here would race with virtualizer measurements that
      // grow `scrollHeight` after a programmatic scroll lands — flipping sticky
      // off in that one frame, then keeping the button stuck on because the
      // corrective syncLayoutNow takes the non-sticky branch.
      if (nextScrollTop < prevScrollTop && !isAtBottom && hasRecentUserScrollIntent()) {
        stickToBottomRef.current = false;
      } else if (isAtBottom) {
        stickToBottomRef.current = true;
      }
      setShowScrollDown(!stickToBottomRef.current && !isAtBottom);
    };

    lastScrollTopRef.current = el.scrollTop;
    handleScroll();
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollRef, threadId]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el && !content) return;
    const observer = new ResizeObserver(() => {
      // ResizeObserver already runs after layout and before paint, so syncing
      // immediately here avoids a visible one-frame catch-up when rows collapse
      // or when the viewport shrinks because surrounding UI grew.
      syncLayoutNowAndAfterPaint();
    });
    if (el) {
      observer.observe(el);
    }
    if (content) {
      observer.observe(content);
    }
    return () => observer.disconnect();
  }, [contentRef, scrollRef, threadId]);

  useEffect(() => {
    if (pinRafRef.current !== null) {
      cancelAnimationFrame(pinRafRef.current);
    }
    pinRafRef.current = requestAnimationFrame(() => {
      pinRafRef.current = null;
      if (!stickToBottomRef.current) return;
      scrollToBottom();
    });
    return () => {
      if (pinRafRef.current !== null) {
        cancelAnimationFrame(pinRafRef.current);
        pinRafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinning is keyed to chat content changes; the helper reads refs/state setters only.
  }, [scrollAnchor, tailLoaderVisible]);

  useEffect(() => cancelScheduledLayoutSync, []);

  return (
    <Button
      isIconOnly
      variant="tertiary"
      size="sm"
      aria-label="Scroll to bottom"
      onPress={scrollToBottom}
      className={`absolute bottom-4 right-4 z-10 transition-opacity duration-200 ease-out ${
        showScrollDown ? "opacity-80 hover:opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <ArrowDown className="size-3.5" strokeWidth={2.5} />
    </Button>
  );
});

interface TurnTiming {
  startedAt: number;
  endedAt: number | null;
}

function parseTurnTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Derives the current or last completed run window from persisted thread timing
 * so reopening a thread doesn't reseed the footer timer from mount time.
 */
function resolveTurnTiming(thread: Thread): TurnTiming | null {
  const isLive = isThreadTurnActive(thread.status);

  if (isLive) {
    const startedAt = parseTurnTimestamp(thread.activeTurnStartedAt ?? thread.createdAt);
    return startedAt === null ? null : { startedAt, endedAt: null };
  }

  const startedAt = parseTurnTimestamp(thread.lastTurnStartedAt);
  const endedAt = parseTurnTimestamp(thread.lastTurnEndedAt);
  if (startedAt === null || endedAt === null) {
    return null;
  }

  return {
    startedAt,
    endedAt: Math.max(startedAt, endedAt),
  };
}

function ChatTailLoader({ turn }: { turn: TurnTiming }) {
  return (
    <div className="mx-auto w-full max-w-[920px]">
      <Surface variant="transparent" className={chatMessageSurfaceClass}>
        <div className="inline-flex items-center gap-1.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
          <WorkingFor turn={turn} />
        </div>
      </Surface>
    </div>
  );
}

/**
 * Self-ticking elapsed-time label. While `turn.endedAt` is null, ticks every
 * second as "Working for N"; once set, freezes as "Worked for N". Mutates
 * `textContent` directly via a ref instead of calling `setState` so the
 * per-second tick produces zero React commits — important while the rest of
 * the chat is potentially streaming.
 */
function WorkingFor({ turn }: { turn: TurnTiming }) {
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      const node = textRef.current;
      if (!node) return;
      if (turn.endedAt !== null) {
        const elapsedSeconds = Math.max(0, Math.floor((turn.endedAt - turn.startedAt) / 1000));
        node.textContent = elapsedSeconds < 1 ? "" : `Worked for ${formatElapsed(elapsedSeconds)}`;
        return;
      }
      const elapsedSeconds = Math.floor((Date.now() - turn.startedAt) / 1000);
      node.textContent = elapsedSeconds < 1 ? "" : `Working for ${formatElapsed(elapsedSeconds)}`;
    };
    update();
    if (turn.endedAt !== null) return;
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [turn.startedAt, turn.endedAt]);

  const className = turn.endedAt === null ? "lightcode-thinking-text" : "text-muted";
  return <span ref={textRef} className={className} aria-live="polite" />;
}

function isElementAtBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EPSILON_PX;
}

function isScrollNavigationKey(key: string): boolean {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End" ||
    key === " "
  );
}

/** ["", "src", "src/foo", "src/foo/bar"] for "src/foo/bar". Empty string is the tree root. */
function collectPathAncestors(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const ancestors: string[] = [""];
  for (let i = 0; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i + 1).join("/"));
  }
  return ancestors;
}

function isCompletedTurnAnchorAtTimelineTail(
  anchorItemId: string | null,
  entries: readonly ChatTimelineEntry[],
): boolean {
  if (anchorItemId === null || entries.length === 0) return true;
  const lastEntry = entries[entries.length - 1]!;
  return lastEntry.kind === "item"
    ? lastEntry.id === anchorItemId
    : lastEntry.itemIds.includes(anchorItemId);
}

type CheckpointGuard = {
  scopeLabel: string;
  hasSharedTree: boolean;
  sharedThreadCount: number;
};

function resolveCheckpointGuard(input: {
  threads: readonly Thread[];
  threadId: string;
  projectId: string;
  worktreePath?: string | undefined;
}): CheckpointGuard {
  const treeKey = checkpointTreeKey(input.projectId, input.worktreePath);
  const sharedThreadCount = input.threads.filter(
    (thread) =>
      thread.id !== input.threadId &&
      !thread.archived &&
      checkpointTreeKey(thread.projectId, thread.worktreePath) === treeKey,
  ).length;
  return {
    scopeLabel: input.worktreePath ? "this worktree" : "the main project tree",
    hasSharedTree: sharedThreadCount > 0,
    sharedThreadCount,
  };
}

function checkpointTreeKey(projectId: string, worktreePath: string | undefined): string {
  return `${projectId}\0${worktreePath ?? ""}`;
}

function findBaseCheckpointItemId(
  itemIds: readonly string[],
  itemsById:
    | ReturnType<typeof useAppStore.getState>["runtimeItemsByIdByThread"][string]
    | undefined,
  checkpointItemId: string,
): string | null {
  const checkpointIndex = itemIds.indexOf(checkpointItemId);
  if (checkpointIndex < 0) return null;
  for (let idx = checkpointIndex; idx >= 0; idx -= 1) {
    const itemId = itemIds[idx]!;
    if (itemsById?.[itemId]?.type === "user_message") return itemId;
  }
  return null;
}
