import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { Bot, X } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { OverlayShell } from "@/renderer/components/layout/OverlayShell";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { getChildItemIdsStoreSelector, getRuntimeItemStoreSelector } from "../../chatPaneSelectors";
import { ChatItemRow } from "./ChatItemRow";
import { ItemMarkdown } from "./ItemMarkdown";
import { extractAcpResultPart } from "./acpToolPayload";
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
  const evictSubAgentChildren = useAppStore((s) => s.evictSubAgentChildren);

  // Subscribe to the supervisor's child-event stream for this sub-agent while
  // the overlay is open. The supervisor buffers events when no renderer is
  // subscribed (perf gate); on subscribe it drains the buffer as `history` and
  // forwards the live tail through the regular runtime-event channels. On
  // unmount we unsubscribe and evict the children locally so reopening
  // hydrates from a clean slate.
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
      evictSubAgentChildren(threadId, parentItemId);
    };
  }, [threadId, parentItemId, applyRuntimeEvents, evictSubAgentChildren]);

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
  const isCompleted = isSubAgentCompleted(item, payload);

  return (
    <Shell
      title={title}
      icon={<Icon className="size-3.5 shrink-0 text-[color:var(--muted)]" />}
      onClose={onClose}
    >
      {isCompleted ? (
        <FinalResult payload={payload} />
      ) : (
        <ChildList threadId={threadId} childIds={childIds} />
      )}
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
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1">
        {icon ?? <Bot className="size-3.5 shrink-0 text-[color:var(--muted)]" />}
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h2>
        <Button
          isIconOnly
          variant="tertiary"
          size="sm"
          className="rounded p-0.5 text-muted"
          aria-label="Close subagent"
          onPress={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function FinalResult({ payload }: { payload: ToolCallPayload | undefined }) {
  const part = extractAcpResultPart(payload);
  if (!part.text) {
    return <p className="px-3 py-4 text-sm text-foreground-muted">Completed with no result.</p>;
  }
  return (
    <div className="px-3 py-3">
      <ItemMarkdown text={part.text} />
    </div>
  );
}

function ChildList({ threadId, childIds }: { threadId: string; childIds: readonly string[] }) {
  if (childIds.length === 0) {
    return <p className="px-3 py-4 text-sm text-foreground-muted">Working…</p>;
  }
  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      {childIds.map((id) => (
        <ChatItemRow
          key={id}
          threadId={threadId}
          entry={{ kind: "item", id }}
          checkpointRevertControl={null}
        />
      ))}
    </div>
  );
}

function isSubAgentCompleted(item: RuntimeChatItem, payload: ToolCallPayload | undefined): boolean {
  if (item.state !== "completed") return false;
  return payload?.status !== "running";
}
