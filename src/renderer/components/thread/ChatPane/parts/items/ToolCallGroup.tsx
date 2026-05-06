import { Button, Disclosure } from "@heroui/react";
import { memo, useEffect, useState } from "react";
import { FileEdit, ListChecks, Search, Terminal, type LucideIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type {
  CommandExecutionPayload,
  FileChangePayload,
  ToolCallPayload,
  WebSearchPayload,
} from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { CommandOutputViewport } from "./CommandOutputViewport";
import { isContextCompactionToolCall } from "./ContextCompaction";
import { ToolCallSections, type ToolCallSection } from "./ToolCallSections";
import {
  extractAcpArgsPart,
  extractAcpResultPart,
  extractAcpResultText,
  readAcpStringField,
} from "./acpToolPayload";
import { humanIntentTitle } from "./commandSummary";
import { pickToolIcon } from "./ToolCall";

interface ToolCallGroupProps {
  threadId: string;
  itemIds: readonly string[];
  /** True while this group is the tail of the timeline. Drives default expand state. */
  isLive?: boolean;
}

const VISIBLE_TOOL_CALLS = 5;

export const ToolCallGroup = memo(function ToolCallGroup({
  threadId,
  itemIds,
  isLive = false,
}: ToolCallGroupProps) {
  const items = useAppStore(
    useShallow((state) =>
      itemIds
        .map((itemId) => state.runtimeItemsByIdByThread[threadId]?.[itemId])
        .filter((item): item is RuntimeChatItem => !!item && isToolGroupItem(item)),
    ),
  );
  const actions = useChatPaneActions();
  // Live tail expands by default so the user sees in-flight calls; collapse
  // automatically once another item arrives after the group (isLive flips
  // false). Manual toggles still apply afterwards.
  const [isExpanded, setIsExpanded] = useState(isLive);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!isLive) setIsExpanded(false);
  }, [isLive]);
  if (items.length === 0) return null;
  const isRunning = items.some((item) => item.state !== "completed");
  const summary = summarizeToolCalls(items);
  const visibleItems = showAll ? items : items.slice(-VISIBLE_TOOL_CALLS);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="w-full rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1.5">
      <Disclosure
        className="text-[length:var(--lc-chat-font-size-command)] leading-tight"
        isExpanded={isExpanded}
        onExpandedChange={(next) => {
          setIsExpanded(next);
          actions?.onContentHeightChange();
        }}
      >
        <div className="flex items-center gap-2 pb-1">
          <Disclosure.Heading className="min-w-0 flex-1">
            <Disclosure.Trigger className="flex w-full min-w-0 items-center gap-1.5 text-left">
              <ListChecks className="size-3 shrink-0 text-[color:var(--muted)]" />
              <code className="min-w-0 flex-1 truncate font-mono uppercase tracking-wide !text-[color:var(--muted)]">
                {summary.title}
              </code>
              {isRunning ? (
                <span className="shrink-0 tabular-nums font-medium text-[color:var(--muted)]">
                  running
                </span>
              ) : null}
              <Disclosure.Indicator className="size-3.5 shrink-0 text-[color:var(--muted)]" />
            </Disclosure.Trigger>
          </Disclosure.Heading>
        </div>
        <Disclosure.Content>
          <Disclosure.Body>
            <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
              {hiddenCount > 0 ? (
                <Button
                  variant="tertiary"
                  size="sm"
                  onPress={() => setShowAll(true)}
                  className="ml-auto px-1.5 text-[length:var(--lc-chat-font-size-command)] uppercase tracking-wide"
                >
                  Show {hiddenCount} more
                </Button>
              ) : null}
              {visibleItems.map((item) => (
                <ToolCallInline key={item.id} item={item} />
              ))}
            </div>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </div>
  );
});

function ToolCallInline({ item }: { item: RuntimeChatItem }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const row = getInlineRow(item, isExpanded);
  if (!row) return null;
  const Icon = row.Icon;

  if (!row.hasDetails) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 py-0.5 text-[length:var(--lc-chat-font-size-command)] leading-tight">
        <Icon className="size-3 shrink-0 text-[color:var(--muted)]" />
        <code className="min-w-0 flex-1 truncate font-mono !text-[color:var(--muted)]">
          {row.title}
        </code>
        {row.rightLabel ? (
          <span className={`shrink-0 tabular-nums font-medium ${row.rightLabelClassName}`}>
            {row.rightLabel}
          </span>
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
            {row.title}
          </code>
          {row.rightLabel ? (
            <span className={`shrink-0 tabular-nums font-medium ${row.rightLabelClassName}`}>
              {row.rightLabel}
            </span>
          ) : null}
          <Disclosure.Indicator className="size-3.5 shrink-0 text-[color:var(--muted)]" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="pb-1 pl-4 pt-1">
          {row.bodyText ? <CommandOutputViewport text={row.bodyText} /> : null}
          <ToolCallSections sections={row.sections} />
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

type InlineRow = {
  Icon: LucideIcon;
  title: string;
  rightLabel?: string | undefined;
  rightLabelClassName: string;
  hasDetails: boolean;
  sections: ToolCallSection[];
  bodyText?: string | undefined;
};

function getInlineRow(item: RuntimeChatItem, isExpanded: boolean): InlineRow | null {
  if (item.type === "command_execution") return getCommandRow(item, isExpanded);
  if (item.type === "file_change") return getFileChangeRow(item, isExpanded);
  if (item.type === "web_search") return getWebSearchRow(item, isExpanded);
  return getToolCallRow(item, isExpanded);
}

function getToolCallRow(item: RuntimeChatItem, isExpanded: boolean): InlineRow | null {
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
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
  return {
    Icon,
    title: payload.name,
    rightLabel: payload.status === "error" ? "error" : undefined,
    rightLabelClassName: "text-danger",
    hasDetails,
    sections,
  };
}

function getCommandRow(item: RuntimeChatItem, isExpanded: boolean): InlineRow | null {
  const payload = getRuntimeItemPayload<CommandExecutionPayload>(item, "command_execution");
  const command =
    payload?.command && payload.command.length > 0
      ? payload.command
      : (readAcpStringField(payload, "command") ?? "");
  const title = command ? `Run: ${humanIntentTitle(command)}` : "Run command";
  const output =
    item.streams.command_output && item.streams.command_output.length > 0
      ? item.streams.command_output
      : extractAcpResultText(payload);
  const isRunning = item.state !== "completed";
  const rightLabel = isRunning
    ? "running"
    : payload?.exitCode && payload.exitCode !== 0
      ? "error"
      : undefined;
  return {
    Icon: Terminal,
    title,
    rightLabel,
    rightLabelClassName: rightLabel === "error" ? "text-danger" : "text-[color:var(--muted)]",
    hasDetails: output.length > 0,
    sections: [],
    bodyText: isExpanded ? output : undefined,
  };
}

function getFileChangeRow(item: RuntimeChatItem, isExpanded: boolean): InlineRow | null {
  const payload = getRuntimeItemPayload<FileChangePayload>(item, "file_change");
  if (!payload?.path) return null;
  const sections: ToolCallSection[] =
    isExpanded && (hasAuxFields(payload) || !item.streams.file_change_output)
      ? [
          { label: "args", part: extractAcpArgsPart(payload) },
          { label: "result", part: extractAcpResultPart(payload) },
        ]
      : [];
  const rightLabel = payload.diffSummary
    ? `${payload.changeKind} +${payload.diffSummary.added} -${payload.diffSummary.removed}`
    : payload.changeKind;
  return {
    Icon: FileEdit,
    title: payload.path,
    rightLabel,
    rightLabelClassName: "text-[color:var(--muted)]",
    hasDetails: !!item.streams.file_change_output || hasAuxFields(payload),
    sections,
    bodyText: isExpanded ? item.streams.file_change_output : undefined,
  };
}

function getWebSearchRow(item: RuntimeChatItem, isExpanded: boolean): InlineRow | null {
  const payload = getRuntimeItemPayload<WebSearchPayload>(item, "web_search");
  if (!payload?.query) return null;
  const sections: ToolCallSection[] =
    isExpanded && hasAuxFields(payload)
      ? [
          { label: "query", part: extractAcpArgsPart(payload) },
          { label: "results", part: extractAcpResultPart(payload) },
        ]
      : [];
  const resultCount = payload.resultCount ?? deriveResultCount(payload);
  return {
    Icon: Search,
    title: payload.query,
    rightLabel:
      resultCount != null ? `${resultCount} result${resultCount === 1 ? "" : "s"}` : undefined,
    rightLabelClassName: "text-[color:var(--muted)]",
    hasDetails: hasAuxFields(payload),
    sections,
  };
}

function summarizeToolCalls(items: readonly RuntimeChatItem[]): { title: string } {
  const counts = new Map<string, number>();
  for (const item of items) {
    const category = categorizeItem(item);
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

function isToolGroupItem(item: RuntimeChatItem): boolean {
  if (isContextCompactionToolCall(item)) return false;
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "web_search"
  );
}

function categorizeItem(item: RuntimeChatItem): string {
  if (item.type === "command_execution") return "command";
  if (item.type === "file_change") return "edit";
  if (item.type === "web_search") return "search";
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  return categorizeToolName(payload?.name ?? "");
}

function hasAuxFields(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return p.args !== undefined || p.result !== undefined;
}

function deriveResultCount(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return undefined;
  const contents = (result as Record<string, unknown>).contents;
  if (Array.isArray(contents)) return contents.length;
  return undefined;
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
