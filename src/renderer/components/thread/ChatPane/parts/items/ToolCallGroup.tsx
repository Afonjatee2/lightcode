import { Disclosure } from "@heroui/react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { CircleAlert, FileEdit, Globe, Terminal, Wrench, type LucideIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type {
  CommandExecutionPayload,
  FileChangePayload,
  ToolCallPayload,
  WebSearchPayload,
} from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
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
  const summary = summarizeToolCalls(items);
  const GroupIcon = pickGroupIcon(items);
  const visibleItems = showAll ? items : items.slice(-VISIBLE_TOOL_CALLS);

  return (
    <div className="w-full rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1">
      <Disclosure
        className="text-[length:var(--lc-chat-font-size-command)] leading-tight"
        isExpanded={isExpanded}
        onExpandedChange={(next) => {
          setIsExpanded(next);
          actions?.onContentHeightChange();
        }}
      >
        <Disclosure.Heading>
          <Disclosure.Trigger className="flex w-full min-w-0 items-center gap-1.5 py-0 text-left">
            <GroupIcon className="size-3 shrink-0 text-[color:var(--muted)]" />
            <code className="min-w-0 flex-1 truncate font-mono !text-[color:var(--muted)]">
              {summary.title}
            </code>
            <Disclosure.Indicator className="size-3.5 shrink-0 text-[color:var(--muted)]" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="mt-0.5 border-t border-[color:var(--border)] pt-1">
            <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
              {items.length > VISIBLE_TOOL_CALLS ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowAll((prev) => !prev)}
                    className="text-[length:var(--lc-chat-font-size-command)] !text-[color:var(--muted)] hover:!text-foreground"
                  >
                    {showAll ? "Show less" : `Show ${items.length - VISIBLE_TOOL_CALLS} more`}
                  </button>
                </div>
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
  rightLabel?: ReactNode;
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
  const isRunning = item.state !== "completed";
  const isError = payload.status === "error";
  const rightLabel: ReactNode = isRunning ? (
    <PixelLoader size="xxs" className="text-[color:var(--muted)]" />
  ) : isError ? (
    <ErrorIcon />
  ) : undefined;
  return {
    Icon,
    title: payload.name,
    rightLabel,
    rightLabelClassName: isError ? "text-danger" : "text-[color:var(--muted)]",
    hasDetails,
    sections,
  };
}

function ErrorIcon() {
  return <CircleAlert className="size-3 text-danger" aria-label="error" />;
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
  const isErrorExit = !isRunning && payload?.exitCode != null && payload.exitCode !== 0;
  const rightLabel: ReactNode = isRunning ? (
    <PixelLoader size="xxs" className="text-[color:var(--muted)]" />
  ) : isErrorExit ? (
    <ErrorIcon />
  ) : undefined;
  return {
    Icon: Terminal,
    title,
    rightLabel,
    rightLabelClassName: isErrorExit ? "text-danger" : "text-[color:var(--muted)]",
    hasDetails: output.length > 0,
    sections: [],
    bodyText: isExpanded ? output : undefined,
  };
}

function getFileChangeRow(item: RuntimeChatItem, isExpanded: boolean): InlineRow | null {
  const payload = getRuntimeItemPayload<FileChangePayload>(item, "file_change");
  if (!payload) return null;
  const sections: ToolCallSection[] =
    isExpanded && (hasAuxFields(payload) || !item.streams.file_change_output)
      ? [
          { label: "args", part: extractAcpArgsPart(payload) },
          { label: "result", part: extractAcpResultPart(payload) },
        ]
      : [];
  const isRunning = item.state !== "completed";
  const rightLabel: ReactNode = isRunning ? (
    <PixelLoader size="xxs" className="text-[color:var(--muted)]" />
  ) : payload.diffSummary ? (
    `${payload.changeKind} +${payload.diffSummary.added} -${payload.diffSummary.removed}`
  ) : (
    payload.changeKind
  );
  // ACP can emit file_change items without an extractable path (path === "").
  // Fall back to the human-readable tool title carried on the ACP payload so
  // the row stays visible inside the group instead of silently dropping out.
  const title =
    payload.path && payload.path.length > 0
      ? payload.path
      : (readPayloadString(payload, "name") ?? "Edit");
  return {
    Icon: FileEdit,
    title,
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
  const isRunning = item.state !== "completed";
  const resultCount = payload.resultCount ?? deriveResultCount(payload);
  const rightLabel: ReactNode = isRunning ? (
    <PixelLoader size="xxs" className="text-[color:var(--muted)]" />
  ) : resultCount != null ? (
    `${resultCount} result${resultCount === 1 ? "" : "s"}`
  ) : undefined;
  return {
    Icon: Globe,
    title: payload.query,
    rightLabel,
    rightLabelClassName: "text-[color:var(--muted)]",
    hasDetails: hasAuxFields(payload),
    sections,
  };
}

/**
 * When every item in the group is the same underlying type, surface the icon
 * the individual row would use; mixed groups stay on the generic Wrench.
 */
function pickGroupIcon(items: readonly RuntimeChatItem[]): LucideIcon {
  const types = new Set<RuntimeChatItem["type"]>();
  for (const item of items) {
    types.add(item.type);
    if (types.size > 1) return Wrench;
  }
  const [only] = [...types];
  if (only === "command_execution") return Terminal;
  if (only === "file_change") return FileEdit;
  if (only === "web_search") return Globe;
  return Wrench;
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
    title: parts.length > 0 ? parts.join(", ") : `${items.length} tools`,
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

function readPayloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
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
