import { memo, useMemo, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { ChatItemAccordion } from "./ChatItemAccordion";
import { ContextCompaction, isContextCompactionToolCall } from "./ContextCompaction";
import { PlanProposal, isPlanProposalToolCall } from "./PlanProposal";
import { ToolCallSections, type ToolCallSection } from "./ToolCallSections";
import { extractAcpArgsPart, extractAcpResultPart } from "./acpToolPayload";
import { deriveToolDisplay, isSkillTool } from "./toolDisplay";

interface ToolCallProps {
  item: RuntimeChatItem;
}

export const ToolCall = memo(function ToolCall({ item }: ToolCallProps) {
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  const [isExpanded, setIsExpanded] = useState(false);
  const sections = useMemo<ToolCallSection[]>(() => {
    if (!isExpanded || !payload) return [];
    const isSkill = isSkillTool(payload);
    return [
      { label: "args", part: extractAcpArgsPart(payload) },
      {
        label: "result",
        part: extractAcpResultPart(payload),
        ...(isSkill ? { renderAsMarkdown: true } : {}),
      },
    ];
  }, [isExpanded, payload]);
  if (!payload?.name) return null;
  if (isContextCompactionToolCall(item)) return <ContextCompaction item={item} />;
  if (isPlanProposalToolCall(item)) return <PlanProposal item={item} />;
  const hasDetails = payload.args !== undefined || payload.result !== undefined;
  const display = deriveToolDisplay(payload);
  const Icon = display.Icon;
  const status = resolveToolStatus(item, payload);

  return (
    <ChatItemAccordion
      icon={<Icon className="size-3" />}
      title={display.title}
      {...(display.parts ? { titleParts: display.parts } : {})}
      rightLabel={status.rightLabel}
      rightLabelClassName={status.rightLabelClassName}
      hasBody={hasDetails}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <ToolCallSections sections={sections} />
    </ChatItemAccordion>
  );
});

interface ToolStatusDisplay {
  rightLabel: ReactNode;
  rightLabelClassName: string;
}

function resolveToolStatus(item: RuntimeChatItem, payload: ToolCallPayload): ToolStatusDisplay {
  const isRunning = item.state !== "completed" || payload.status === "running";
  if (isRunning) {
    return {
      rightLabel: <PixelLoader size="xxs" className="text-[color:var(--muted)]" />,
      rightLabelClassName: "!text-[color:var(--muted)]",
    };
  }
  if (payload.status === "error") {
    return {
      rightLabel: <CircleAlert className="size-3 text-danger" aria-label="error" />,
      rightLabelClassName: "text-danger",
    };
  }
  return { rightLabel: null, rightLabelClassName: "!text-[color:var(--muted)]" };
}
