import { memo, useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronRight, CircleAlert, type LucideIcon } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { PathDisplay, PixelLoader } from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { getChildItemIdsStoreSelector } from "../../chatPaneSelectors";
import { extractAcpResultPart } from "./acpToolPayload";
import { ItemMarkdown } from "./ItemMarkdown";
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
  const isCompleted = item.state === "completed" && payload.status !== "running";
  const resultText = isCompleted ? extractAcpResultPart(payload).text.trim() : "";

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
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
            {display.parts.filePath ? (
              <PathDisplay
                className="flex-1"
                path={display.parts.path}
                basenameClassName="!text-[color:var(--foreground)]"
                dirClassName="!text-[color:var(--muted)]"
              />
            ) : (
              <span className="lc-truncate-start flex-1">{display.parts.path}</span>
            )}
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
      {resultText ? <SubAgentResultDisclosure text={resultText} /> : null}
    </div>
  );
});

function SubAgentResultDisclosure({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const actions = useChatPaneActions();
  return (
    <div className="flex w-full flex-col items-stretch justify-center px-1 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
      <button
        type="button"
        onClick={() => {
          setIsOpen((v) => !v);
          actions?.onContentHeightChange();
        }}
        aria-expanded={isOpen}
        className="inline-flex min-w-0 items-center gap-1.5 self-start leading-none italic opacity-80 hover:text-foreground hover:opacity-100"
      >
        <Bot className="size-3 shrink-0" />
        <span>Subagent Result</span>
        <ChevronDown
          className={`size-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen ? (
        <div className="mt-2 max-h-64 overflow-y-auto border-l border-dashed border-[color:var(--border)] pl-3 [scrollbar-gutter:stable]">
          <ItemMarkdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

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
