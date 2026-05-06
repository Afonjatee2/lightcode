import { Button, Disclosure } from "@heroui/react";
import { memo, useState } from "react";
import { ListChecks } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { ToolCallPayload } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { ChatItemAccordion } from "./ChatItemAccordion";
import { ToolCallSections, type ToolCallSection } from "./ToolCallSections";
import { extractAcpArgsPart, extractAcpResultPart } from "./acpToolPayload";
import { pickToolIcon } from "./ToolCall";

interface ToolCallGroupProps {
  threadId: string;
  itemIds: readonly string[];
}

const VISIBLE_TOOL_CALLS = 5;

export const ToolCallGroup = memo(function ToolCallGroup({
  threadId,
  itemIds,
}: ToolCallGroupProps) {
  const items = useAppStore(
    useShallow((state) =>
      itemIds
        .map((itemId) => state.runtimeItemsByIdByThread[threadId]?.[itemId])
        .filter((item): item is RuntimeChatItem => item?.type === "tool_call"),
    ),
  );
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const isRunning = items.some((item) => item.state !== "completed");
  const isExpanded = userOpen === null ? isRunning : userOpen;
  const summary = summarizeToolCalls(items);
  const visibleItems = showAll ? items : items.slice(-VISIBLE_TOOL_CALLS);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <ChatItemAccordion
      icon={<ListChecks className="size-3" />}
      title={summary.title}
      rightLabel={isRunning ? "running" : undefined}
      hasBody={items.length > 0}
      isExpanded={isExpanded}
      onExpandedChange={setUserOpen}
    >
      <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
        {hiddenCount > 0 ? (
          <Button
            variant="tertiary"
            size="sm"
            onPress={() => setShowAll(true)}
            className="self-start px-1.5 text-[length:var(--lc-chat-font-size-command)]"
          >
            Show previous {hiddenCount}
          </Button>
        ) : null}
        {visibleItems.map((item) => (
          <ToolCallInline key={item.id} item={item} />
        ))}
      </div>
    </ChatItemAccordion>
  );
});

function ToolCallInline({ item }: { item: RuntimeChatItem }) {
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  const [isExpanded, setIsExpanded] = useState(false);
  if (!payload?.name) return null;
  const hasDetails = payload.args !== undefined || payload.result !== undefined;
  const Icon = pickToolIcon(payload);
  const sections: ToolCallSection[] =
    isExpanded && hasDetails
      ? [
          { label: "args", part: extractAcpArgsPart(payload) },
          { label: "result", part: extractAcpResultPart(payload) },
        ]
      : [];

  if (!hasDetails) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 py-0.5 text-[length:var(--lc-chat-font-size-command)] leading-tight">
        <Icon className="size-3 shrink-0 text-[color:var(--muted)]" />
        <code className="min-w-0 flex-1 truncate font-mono !text-[color:var(--muted)]">
          {payload.name}
        </code>
        {payload.status === "error" ? (
          <span className="shrink-0 tabular-nums font-medium text-danger">error</span>
        ) : null}
      </div>
    );
  }

  return (
    <Disclosure
      className="text-[length:var(--lc-chat-font-size-command)] leading-tight"
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left">
          <Icon className="size-3 shrink-0 text-[color:var(--muted)]" />
          <code className="min-w-0 flex-1 truncate font-mono !text-[color:var(--muted)]">
            {payload.name}
          </code>
          {payload.status === "error" ? (
            <span className="shrink-0 tabular-nums font-medium text-danger">error</span>
          ) : null}
          <Disclosure.Indicator className="size-3.5 shrink-0 text-[color:var(--muted)]" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="pb-1 pl-4 pt-1">
          <ToolCallSections sections={sections} />
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

function summarizeToolCalls(items: readonly RuntimeChatItem[]): { title: string } {
  const counts = new Map<string, number>();
  for (const item of items) {
    const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
    const category = categorizeToolName(payload?.name ?? "");
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const topCounts = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const parts = topCounts.map(
    ([label, count]) => `${count} ${count === 1 ? label : pluralizeLabel(label)}`,
  );
  const rest = items.length - topCounts.reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0) parts.push(`${rest} other`);
  return {
    title: `${items.length} tool calls${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`,
  };
}

function categorizeToolName(name: string): string {
  const t = name.toLowerCase().trim();
  if (t.startsWith("viewing") || t.startsWith("reading") || t.startsWith("read ")) return "viewed";
  if (t.startsWith("searching") || t.startsWith("finding") || t.startsWith("grep")) {
    return "search";
  }
  if (t.startsWith("editing") || t.startsWith("writing") || t.startsWith("patching")) {
    return "edit";
  }
  if (t.startsWith("running") || t.startsWith("executing") || t.startsWith("shell")) {
    return "command";
  }
  return "tool";
}

function pluralizeLabel(label: string): string {
  if (label === "search") return "searches";
  if (label === "viewed") return "viewed";
  return `${label}s`;
}
