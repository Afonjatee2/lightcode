import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { Bot, X } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { OverlayShell } from "@/renderer/components/layout/OverlayShell";
import { useAppStore } from "@/renderer/state/appStore";
import { getRuntimeItemPayload } from "@/renderer/state/slices/runtimeEventSlice";
import { getChildItemIdsStoreSelector, getRuntimeItemStoreSelector } from "../../chatPaneSelectors";
import { isElementAtBottom } from "../../chatScrollGeometry";
import { ChatItemRow } from "./ChatItemRow";
import { deriveToolDisplay } from "./toolDisplay";

interface SubAgentOverlayProps {
  threadId: string;
}

export function SubAgentOverlay({ threadId }: SubAgentOverlayProps) {
  const openParentItemId = useAppStore((s) => s.openSubAgentByThread[threadId] ?? null);
  const closeSubAgent = useAppStore((s) => s.closeSubAgent);

  // Keep the body rendered through the fade-out by remembering the last
  // non-null parent id; cleared once the OverlayShell finishes its exit.
  const lastParentRef = useRef<string | null>(null);
  if (openParentItemId) lastParentRef.current = openParentItemId;
  const renderingParentItemId = lastParentRef.current;

  if (!renderingParentItemId) return null;

  return (
    <OverlayShell
      mode="absolute"
      open={openParentItemId !== null}
      onExited={() => {
        lastParentRef.current = null;
        closeSubAgent(threadId);
      }}
    >
      <SubAgentOverlayBody
        threadId={threadId}
        parentItemId={renderingParentItemId}
        onClose={() => closeSubAgent(threadId)}
      />
    </OverlayShell>
  );
}

interface SubAgentOverlayBodyProps {
  threadId: string;
  parentItemId: string;
  onClose: () => void;
}

function SubAgentOverlayBody({ threadId, parentItemId, onClose }: SubAgentOverlayBodyProps) {
  const item = useAppStore(getRuntimeItemStoreSelector(threadId, parentItemId));
  const childIds = useAppStore(getChildItemIdsStoreSelector(threadId, parentItemId));
  const applyRuntimeEvents = useAppStore((s) => s.applyRuntimeEvents);

  // Subscribe to the supervisor's child-event stream for this sub-agent while
  // the overlay is open. The supervisor buffers events when no renderer is
  // subscribed (perf gate); on subscribe it drains the buffer as `history` and
  // forwards the live tail through the regular runtime-event channels. Items
  // already in the store are no-ops when replayed, so we keep the persisted
  // child history intact and let any new events layer on top.
  useEffect(() => {
    let cancelled = false;
    const bridge = readBridge();
    void bridge
      .subagentSubscribe({ threadId, parentItemId })
      .then((result) => {
        if (cancelled || result.history.length === 0) return;
        applyRuntimeEvents(threadId, result.history);
      })
      .catch((err: unknown) => {
        console.warn("[subagent] subscribe failed", { threadId, parentItemId, err });
      });
    return () => {
      cancelled = true;
      void bridge.subagentUnsubscribe({ threadId, parentItemId }).catch((err: unknown) => {
        console.warn("[subagent] unsubscribe failed", { threadId, parentItemId, err });
      });
    };
  }, [threadId, parentItemId, applyRuntimeEvents]);

  if (!item) {
    return (
      <Shell title="Subagent" onClose={onClose}>
        <p className="px-3 py-4 text-sm text-foreground-muted">Subagent not found.</p>
      </Shell>
    );
  }

  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  const display = payload ? deriveToolDisplay(payload) : null;
  const Icon = display?.Icon ?? Bot;
  const title = display?.title ?? "Subagent";
  const isRunning = item.state !== "completed" || payload?.status === "running";

  return (
    <Shell
      title={title}
      icon={<Icon className="size-3.5 shrink-0 text-[color:var(--muted)]" />}
      onClose={onClose}
    >
      <ChildList threadId={threadId} childIds={childIds} stickToBottom={isRunning} />
    </Shell>
  );
}

function Shell({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="flex h-full min-h-0 flex-col bg-[var(--content-background)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border)] px-2 py-1">
        {icon ?? <Bot className="size-3.5 shrink-0 text-[color:var(--muted)]" />}
        <h2
          id={titleId}
          className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-foreground"
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close subagent"
          className="shrink-0 rounded p-1 text-muted/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function ChildList({
  threadId,
  childIds,
  stickToBottom,
}: {
  threadId: string;
  childIds: readonly string[];
  stickToBottom: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const scrollToBottom = useEffectEvent(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  });

  // Pin to bottom on first paint so opening the overlay lands on the latest
  // child step rather than the start of the trail.
  useLayoutEffect(() => {
    stickRef.current = true;
    scrollToBottom();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const prev = lastScrollTopRef.current;
      const next = el.scrollTop;
      lastScrollTopRef.current = next;
      const atBottom = isElementAtBottom(el);
      if (next < prev && !atBottom) {
        stickRef.current = false;
      } else if (atBottom) {
        stickRef.current = true;
      }
    };
    lastScrollTopRef.current = el.scrollTop;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const syncStickyScroll = useEffectEvent(() => {
    if (!stickRef.current) return;
    scrollToBottom();
  });

  useEffect(() => {
    if (!stickToBottom) return;
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      syncStickyScroll();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [stickToBottom]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div ref={contentRef} className="flex flex-col gap-1.5 px-3 py-3">
        {childIds.length === 0 ? (
          <p className="text-sm text-foreground-muted">Working…</p>
        ) : (
          childIds.map((id) => (
            <ChatItemRow
              key={id}
              threadId={threadId}
              entry={{ kind: "item", id }}
              checkpointRevertControl={null}
            />
          ))
        )}
      </div>
    </div>
  );
}

