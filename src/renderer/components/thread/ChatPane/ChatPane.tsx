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
} from "./chatPaneSelectors";
import { normalizeChatRelativePath } from "./chatPathUtils";
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
    useShallow((s) => selectVisibleThreadTimelineEntries(s, thread.id, hiddenRuntimeItemId)),
  );
  const project = useAppStore((s) => s.projects.find((p) => p.id === thread.projectId));
  const branch = resolveWorktreeBranch(
    thread.projectId,
    thread.worktreePath ?? "",
    thread.worktreeBranch,
  );
  const targetContext = useMemo(
    () => (project ? buildFileEditorContext(project, thread.worktreePath, branch) : null),
    [project, thread.worktreePath, branch],
  );
  const projectRootNames = useProjectRootNames(targetContext?.projectLocation);

  const paneActions: ChatPaneActions | null = useMemo(() => {
    if (!project || !targetContext) return null;
    return {
      openProjectRelativePath: (path, lineNumber) => {
        void openFileInEditor(
          project,
          thread.worktreePath,
          branch,
          normalizeChatRelativePath(path),
          lineNumber,
        );
      },
      revealProjectFolderInTree: (path) => {
        const normalized = normalizeChatRelativePath(path);
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
        const normalized = normalizeChatRelativePath(path);
        void readBridge().revealProjectEntry({
          projectLocation: targetContext.projectLocation,
          path: normalized,
        });
      },
      onContentHeightChange: () => scrollControlsRef.current?.onContentHeightChange(),
      projectLocation: targetContext.projectLocation,
      projectRootNames,
    };
  }, [project, targetContext, branch, thread.worktreePath, projectRootNames]);

  useEffect(() => {
    void hydrateThreadRuntimeItems(thread.id);
  }, [thread.id]);

  const isEmpty = timelineEntries.length === 0 && !hasSupplementaryContent;
  const isLive = isThreadTurnActive(thread.status);
  // Anchor on thread.status alone — gating on item state caused the loader to
  // disappear in the gap between an item flipping to `completed` and the next
  // `item.started` arriving, even though the runtime was still working the
  // turn. The pinned plan/budget item already advertises its own running
  // state, so suppress the tail when that's live to avoid double indicators.
  const turn = resolveTurnTiming(thread);
  const showTailLoader = (isLive || turn?.endedAt != null) && !hiddenRuntimeItemIsLive;
  const showEmptyHint = isEmpty && !isLive;
  // The tail loader displays the most recent completed turn's frozen elapsed
  // time when the thread is idle. Suppress that turn's inline indicator so we
  // don't render the same "Worked for X" twice.
  const mostRecentCompletedTurnAnchor = useAppStore((s) => {
    if (isLive || !showTailLoader) return null;
    const records = s.runtimeCompletedTurnsByThread[thread.id];
    return records && records.length > 0 ? (records[records.length - 1]?.anchorItemId ?? null) : null;
  });

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
                scrollControlsRef.current?.disableStickToBottom();
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
                    key={thread.id}
                    threadId={thread.id}
                    entries={timelineEntries}
                    scrollElement={scrollEl}
                    suppressInlineTurnAnchorId={mostRecentCompletedTurnAnchor}
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
            threadId={thread.id}
            tailLoaderVisible={showTailLoader}
          />
          <SubAgentOverlay threadId={thread.id} />
        </div>
      </div>
    </ChatPaneActionsContext.Provider>
  );
}

type ChatScrollControlsHandle = {
  disableStickToBottom(): void;
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

  useImperativeHandle(ref, () => ({
    disableStickToBottom,
    onContentHeightChange: syncLayoutNow,
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
    syncLayoutNow();
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
      if (nextScrollTop < prevScrollTop && !isAtBottom) {
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
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      // ResizeObserver already runs after layout and before paint, so syncing
      // immediately here avoids a visible one-frame catch-up when rows collapse.
      syncLayoutNow();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef, threadId]);

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
    const startedAt = parseTurnTimestamp(thread.activeTurnStartedAt ?? thread.updatedAt);
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

/** ["", "src", "src/foo", "src/foo/bar"] for "src/foo/bar". Empty string is the tree root. */
function collectPathAncestors(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const ancestors: string[] = [""];
  for (let i = 0; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i + 1).join("/"));
  }
  return ancestors;
}
