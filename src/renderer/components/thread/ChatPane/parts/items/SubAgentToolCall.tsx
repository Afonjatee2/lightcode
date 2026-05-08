import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleAlert, type LucideIcon } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { ChatItemAccordion } from "./ChatItemAccordion";
import { ChatItemRow } from "./ChatItemRow";
import { getChildItemIdsStoreSelector } from "../../chatPaneSelectors";
import { deriveToolDisplay } from "./toolDisplay";

interface SubAgentToolCallProps {
  threadId: string;
  item: RuntimeChatItem;
}

const SCROLL_MAX_HEIGHT_PX = 480;
const ESTIMATED_CHILD_ROW_PX = 80;
const VIRTUAL_OVERSCAN = 4;

/**
 * Tool-call row for a sub-agent parent (e.g. Claude `Task`). Renders the
 * standard tool header but attaches its child items inline; collapsed by
 * default, expandable to a virtualized scroll-pane that reuses the chat row
 * components for each child step.
 */
export const SubAgentToolCall = memo(function SubAgentToolCall({
  threadId,
  item,
}: SubAgentToolCallProps) {
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  const childIds = useAppStore(getChildItemIdsStoreSelector(threadId, item.id));
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => ESTIMATED_CHILD_ROW_PX, []);
  const getItemKey = useCallback((index: number) => childIds[index] ?? index, [childIds]);

  const virtualizer = useVirtualizer({
    count: childIds.length,
    getScrollElement,
    estimateSize,
    getItemKey,
    overscan: VIRTUAL_OVERSCAN,
    useFlushSync: false,
  });

  const childCount = childIds.length;
  const status = useMemo(
    () => resolveStatus(item, payload, childCount),
    [item, payload, childCount],
  );

  if (!payload?.name) return null;
  const display = deriveToolDisplay(payload);
  const Icon: LucideIcon = display.Icon;

  const virtualItems = isExpanded ? virtualizer.getVirtualItems() : [];
  const totalSize = isExpanded ? virtualizer.getTotalSize() : 0;

  return (
    <ChatItemAccordion
      icon={<Icon className="size-3" />}
      title={display.title}
      rightLabel={status.rightLabel}
      rightLabelClassName={status.rightLabelClassName}
      hasBody={childCount > 0}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: SCROLL_MAX_HEIGHT_PX }}>
        <div className="relative w-full" style={{ height: totalSize }}>
          {virtualItems.map((vi) => {
            const childId = childIds[vi.index];
            if (!childId) return null;
            return (
              <div
                key={vi.key}
                ref={(el) => virtualizer.measureElement(el)}
                data-index={vi.index}
                className="absolute left-0 top-0 w-full pb-1"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <ChatItemRow threadId={threadId} entry={{ kind: "item", id: childId }} />
              </div>
            );
          })}
        </div>
      </div>
    </ChatItemAccordion>
  );
});

interface SubAgentStatus {
  rightLabel: React.ReactNode;
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
  const stepLabel = `${childCount} step${childCount === 1 ? "" : "s"}`;

  if (isRunning) {
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
    rightLabel: <span title={progress?.summary ?? undefined}>{stepLabel}</span>,
    rightLabelClassName: "!text-[color:var(--muted)]",
  };
}
