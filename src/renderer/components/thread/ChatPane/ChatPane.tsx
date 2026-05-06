import {
  forwardRef,
  memo,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@heroui/react";
import { ArrowDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Thread } from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { hydrateThreadRuntimeItems } from "@/renderer/state/chatRuntimePersister";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useProjectTreeStore } from "@/renderer/state/projectTreeStore";
import type { OpenRuntimeRequest } from "@/renderer/state/slices/runtimeEventSlice";
import {
  buildFileEditorContext,
  openFileInEditor,
  resolveWorktreeBranch,
} from "@/renderer/utils/gitHelpers";
import { ChatPaneActionsContext, type ChatPaneActions } from "./chatPaneActionsContext";
import {
  selectChatScrollAnchor,
  selectChatScrollAnchorForTimeline,
  selectThreadHasLiveVisibleRuntimeItem,
  selectVisibleThreadTimelineEntries,
} from "./chatPaneSelectors";
import { normalizeChatRelativePath } from "./chatPathUtils";
import { ApprovalCard } from "./parts/ApprovalCard";
import { MessageList } from "./parts/MessageList";

interface ChatPaneProps {
  thread: Thread;
  hiddenRuntimeItemId?: string | undefined;
  hiddenRuntimeItemIsLive?: boolean;
  hasSupplementaryContent?: boolean;
}

const BOTTOM_EPSILON_PX = 4;

/**
 * Renderer-native chat surface for `presentationMode === "gui"` threads.
 *
 * Pulls canonical chat items from the Zustand `runtimeEventSlice` (populated
 * by IPC `thread-runtime-event` notifications) and renders them as a dense
 * vertical list. Pending approval / user-input requests render inline at the
 * bottom; resolution flows through the same RPC terminal mode uses.
 */
export function ChatPane(props: ChatPaneProps) {
  const {
    thread,
    hiddenRuntimeItemId,
    hiddenRuntimeItemIsLive = false,
    hasSupplementaryContent = false,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollControlsRef = useRef<ChatScrollControlsHandle>(null);
  const timelineEntries = useAppStore(
    useShallow((s) => selectVisibleThreadTimelineEntries(s, thread.id, hiddenRuntimeItemId)),
  );
  const hasLiveItem = useAppStore((s) =>
    selectThreadHasLiveVisibleRuntimeItem(s, thread.id, hiddenRuntimeItemId),
  );
  const requests = useAppStore((s) => s.runtimeRequestsByThread[thread.id] ?? EMPTY_REQUESTS);
  const project = useAppStore((s) => s.projects.find((p) => p.id === thread.projectId));

  const paneActions: ChatPaneActions | null = useMemo(() => {
    if (!project) return null;
    const branch = resolveWorktreeBranch(
      thread.projectId,
      thread.worktreePath ?? "",
      thread.worktreeBranch,
    );
    const targetContext = buildFileEditorContext(project, thread.worktreePath, branch);
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
    };
  }, [project, thread.projectId, thread.worktreeBranch, thread.worktreePath]);

  useEffect(() => {
    void hydrateThreadRuntimeItems(thread.id);
  }, [thread.id]);

  const requestCount = requests.length;
  const isEmpty = timelineEntries.length === 0 && requestCount === 0 && !hasSupplementaryContent;
  const isLive = thread.status === "launching" || thread.status === "working";
  const showTailLoader = isLive && !hasLiveItem && !hiddenRuntimeItemIsLive;
  const showEmptyHint = isEmpty && !isLive;

  return (
    <ChatPaneActionsContext.Provider value={paneActions}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="min-h-0 h-full overflow-y-auto [scrollbar-gutter:stable]"
            onWheelCapture={(event) => {
              if (event.deltaY < 0) {
                scrollControlsRef.current?.disableStickToBottom();
              }
            }}
          >
            <div ref={contentRef} className="min-h-full">
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
                    scrollRef={scrollRef}
                  />
                  <ApprovalRequestList threadId={thread.id} requests={requests} />
                  {showTailLoader ? <ChatTailLoader /> : null}
                </>
              )}
            </div>
          </div>
          <ChatScrollControls
            ref={scrollControlsRef}
            scrollRef={scrollRef}
            contentRef={contentRef}
            hiddenRuntimeItemId={hiddenRuntimeItemId}
            threadId={thread.id}
            requestCount={requestCount}
            tailLoaderVisible={showTailLoader}
          />
        </div>
      </div>
    </ChatPaneActionsContext.Provider>
  );
}

const EMPTY_REQUESTS = Object.freeze([]) as ReadonlyArray<never>;

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
    threadId: string;
    requestCount: number;
    tailLoaderVisible: boolean;
  }
>(function ChatScrollControls(props, ref) {
  const { scrollRef, contentRef, hiddenRuntimeItemId, threadId, requestCount, tailLoaderVisible } =
    props;
  const scrollAnchor = useAppStore((s) =>
    hiddenRuntimeItemId
      ? selectChatScrollAnchorForTimeline(s, threadId, hiddenRuntimeItemId)
      : selectChatScrollAnchor(s, threadId),
  );
  const lastScrollTopRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const pinRafRef = useRef<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  function syncBottomStateFromLayout() {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = isElementAtBottom(el);
    stickToBottomRef.current = isAtBottom;
    setShowScrollDown(!isAtBottom);
  }

  function disableStickToBottom() {
    if (!stickToBottomRef.current) return;
    stickToBottomRef.current = false;
    setShowScrollDown(true);
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const prevScrollTop = lastScrollTopRef.current;
      const nextScrollTop = el.scrollTop;
      lastScrollTopRef.current = nextScrollTop;
      const isAtBottom = isElementAtBottom(el);
      stickToBottomRef.current = nextScrollTop < prevScrollTop ? false : isAtBottom;
      setShowScrollDown(!isAtBottom);
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
  }, [requestCount, scrollAnchor, tailLoaderVisible]);

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

function ChatTailLoader() {
  return (
    <div className="mx-auto flex w-full max-w-[920px] px-3 pb-2">
      <div className="flex h-7 items-center text-foreground-muted">
        <PixelLoader size="xs" />
      </div>
    </div>
  );
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

const ApprovalRequestList = memo(function ApprovalRequestList(props: {
  threadId: string;
  requests: ReadonlyArray<OpenRuntimeRequest>;
}) {
  const { threadId, requests } = props;
  if (requests.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-[920px] px-3">
      {requests.map((request) => (
        <ApprovalCard key={request.requestId} threadId={threadId} request={request} />
      ))}
    </div>
  );
});
