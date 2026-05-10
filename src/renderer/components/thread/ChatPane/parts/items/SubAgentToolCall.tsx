import { memo, type ReactNode } from "react";
import { ChevronRight, CircleAlert, type LucideIcon } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { getChildItemIdsStoreSelector } from "../../chatPaneSelectors";
import { deriveToolDisplay } from "./toolDisplay";

interface SubAgentToolCallProps {
  threadId: string;
  item: RuntimeChatItem;
}

export const SubAgentToolCall = memo(function SubAgentToolCall({
  threadId,
  item,
}: SubAgentToolCallProps) {
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  const childCount = useAppStore(getChildItemIdsStoreSelector(threadId, item.id)).length;
  const openSubAgent = useAppStore((s) => s.openSubAgent);

  if (!payload?.name) return null;
  const display = deriveToolDisplay(payload);
  const Icon: LucideIcon = display.Icon;
  const status = resolveStatus(item, payload, childCount);

  return (
    <button
      type="button"
      onClick={() => openSubAgent(threadId, item.id)}
      className="group flex w-full min-w-0 items-center gap-1.5 rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1 text-left text-[length:var(--lc-chat-font-size-command)] leading-tight transition-colors hover:bg-foreground/5"
      aria-label={`Open subagent: ${display.title}`}
    >
      <span className="size-3 shrink-0 text-[color:var(--muted)]">
        <Icon className="size-3" />
      </span>
      {display.parts ? (
        <code className="flex min-w-0 flex-1 items-baseline overflow-hidden font-mono text-[color:var(--muted)]">
          <span className="shrink-0 whitespace-pre">{display.parts.prefix}</span>
          <span className="lc-truncate-start flex-1">{display.parts.path}</span>
        </code>
      ) : (
        <code className="block min-w-0 flex-1 truncate font-mono text-[color:var(--muted)]">
          {display.title}
        </code>
      )}
      {status.rightLabel ? (
        <span className={`shrink-0 tabular-nums font-medium ${status.rightLabelClassName}`}>
          {status.rightLabel}
        </span>
      ) : null}
      <ChevronRight className="size-3.5 shrink-0 text-[color:var(--muted)] opacity-60 transition-opacity group-hover:opacity-100" />
    </button>
  );
});

interface SubAgentStatus {
  rightLabel: ReactNode;
  rightLabelClassName: string;
}

function resolveStatus(
  item: RuntimeChatItem,
  payload: ToolCallPayload | undefined,
  childCount: number,
): SubAgentStatus {
  const isRunning = item.state !== "completed" || payload?.status === "running";
  const progress = payload?.progress;
  const liveLabel = progress?.lastToolName ?? progress?.description;
  // Prefer the supervisor-reported counter — it survives child-event gating
  // (overlay closed); fall back to local children count when the supervisor
  // hasn't populated stepCount yet.
  const stepCount = progress?.stepCount ?? childCount;

  if (isRunning) {
    const stepLabel = `${stepCount} step${stepCount === 1 ? "" : "s"}`;
    return {
      rightLabel: (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[color:var(--muted)]">
          {liveLabel ? (
            <span className="max-w-[28ch] truncate" title={progress?.description ?? liveLabel}>
              {liveLabel}
            </span>
          ) : null}
          <span>{stepLabel}</span>
          <PixelLoader size="xxs" className="text-[color:var(--muted)]" />
        </span>
      ),
      rightLabelClassName: "!text-[color:var(--muted)]",
    };
  }
  if (payload?.status === "error") {
    return {
      rightLabel: <CircleAlert className="size-3 text-danger" aria-label="error" />,
      rightLabelClassName: "text-danger",
    };
  }
  return {
    rightLabel: <span className="text-[color:var(--muted)]">done</span>,
    rightLabelClassName: "!text-[color:var(--muted)]",
  };
}
