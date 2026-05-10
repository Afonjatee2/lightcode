import { Disclosure } from "@heroui/react";
import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  Eye,
  FileEdit,
  Globe,
  Pencil,
  SearchCode,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
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
import { formatKindLabel } from "./FileChange";
import { isPlanProposalToolCall } from "./PlanProposal";
import { ToolCallSections, type ToolCallSection } from "./ToolCallSections";
import {
  extractAcpArgsPart,
  extractAcpResultPart,
  extractAcpResultText,
  readAcpStringField,
} from "./acpToolPayload";
import { humanIntentTitle } from "./commandSummary";
import { deriveToolDisplay } from "./toolDisplay";

interface ToolCallGroupProps {
  threadId: string;
  itemIds: readonly string[];
  /** True while this group is the tail of the timeline. Drives default expand state. */
  isLive?: boolean;
}

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLive) setIsExpanded(false);
  }, [isLive]);

  // Auto-scroll to bottom when new items arrive in live mode
  useEffect(() => {
    if (isLive && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items.length, isLive, isExpanded]);

  if (items.length === 0) return null;
  const sections = summarizeToolCalls(items);

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
          <Disclosure.Trigger className="flex w-full min-w-0 items-center gap-2 py-0 text-left">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap text-[color:var(--muted)]">
              {sections.map((section, idx) => (
                <Fragment key={section.category}>
                  {idx > 0 ? (
                    <span aria-hidden="true" className="select-none opacity-40">
                      ·
                    </span>
                  ) : null}
                  <span className="flex shrink-0 items-center gap-1">
                    <section.Icon className="size-3" />
                    <code className="font-mono tabular-nums !text-[color:var(--muted)]">
                      {section.count} {section.label}
                    </code>
                  </span>
                </Fragment>
              ))}
            </div>
            <Disclosure.Indicator className="size-3.5 shrink-0 text-[color:var(--muted)]" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="mt-0.5 border-t border-[color:var(--border)] pt-1">
            <div ref={scrollRef} className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="animate-tool-call-enter">
                  <ToolCallInline item={item} />
                </div>
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
        <InlineRowTitle
          title={row.title}
          {...(row.titleParts ? { titleParts: row.titleParts } : {})}
        />
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
          <InlineRowTitle
            title={row.title}
            {...(row.titleParts ? { titleParts: row.titleParts } : {})}
          />
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
  /**
   * Optional structured title — see `ToolDisplay.parts`. When present the row
   * keeps `prefix` fully visible and truncates `path` from the start.
   */
  titleParts?: { prefix: string; path: string };
  rightLabel?: ReactNode;
  rightLabelClassName: string;
  hasDetails: boolean;
  sections: ToolCallSection[];
  bodyText?: string | undefined;
};

function InlineRowTitle({
  title,
  titleParts,
}: {
  title: string;
  titleParts?: { prefix: string; path: string };
}) {
  if (titleParts) {
    return (
      <code className="flex min-w-0 flex-1 items-baseline overflow-hidden font-mono !text-[color:var(--muted)]">
        <span className="shrink-0 whitespace-pre">{titleParts.prefix}</span>
        <span className="lc-truncate-start flex-1">{titleParts.path}</span>
      </code>
    );
  }
  return (
    <code className="min-w-0 flex-1 truncate font-mono !text-[color:var(--muted)]">{title}</code>
  );
}

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
  const display = deriveToolDisplay(payload);
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
    Icon: display.Icon,
    title: display.title,
    ...(display.parts ? { titleParts: display.parts } : {}),
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
  const title = command ? humanIntentTitle(command) : "Run command";
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
    `+${payload.diffSummary.added} -${payload.diffSummary.removed}`
  ) : undefined;
  const kindLabel = formatKindLabel(payload.changeKind);
  // ACP can emit file_change items without an extractable path (path === "").
  // Fall back to the human-readable tool title carried on the ACP payload so
  // the row stays visible inside the group instead of silently dropping out.
  const pathOrName =
    payload.path && payload.path.length > 0 ? payload.path : readPayloadString(payload, "name");
  const title = pathOrName ? `${kindLabel} ${pathOrName}` : kindLabel.replace(/:$/, "");
  const titleParts =
    pathOrName && payload.path && payload.path.length > 0
      ? { prefix: `${kindLabel} `, path: pathOrName }
      : undefined;
  return {
    Icon: FileEdit,
    title,
    ...(titleParts ? { titleParts } : {}),
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

type GroupCategory = "viewed" | "searched" | "edited" | "executed" | "other";

interface CategoryMeta {
  Icon: LucideIcon;
  singular: string;
  plural: string;
  /** Tiebreaker when two categories share a count — lower wins. */
  priority: number;
}

const CATEGORY_META: Record<GroupCategory, CategoryMeta> = {
  viewed: { Icon: Eye, singular: "view", plural: "views", priority: 0 },
  searched: { Icon: SearchCode, singular: "search", plural: "searches", priority: 1 },
  edited: { Icon: Pencil, singular: "edit", plural: "edits", priority: 2 },
  executed: { Icon: Terminal, singular: "command", plural: "commands", priority: 3 },
  other: { Icon: Wrench, singular: "tool", plural: "tools", priority: 4 },
};

interface GroupSection {
  category: GroupCategory;
  count: number;
  label: string;
  Icon: LucideIcon;
}

function summarizeToolCalls(items: readonly RuntimeChatItem[]): GroupSection[] {
  const counts = new Map<GroupCategory, number>();
  for (const item of items) {
    const category = categorizeItem(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      ([aCat, aCount], [bCat, bCount]) =>
        bCount - aCount || CATEGORY_META[aCat].priority - CATEGORY_META[bCat].priority,
    )
    .map(([category, count]) => {
      const meta = CATEGORY_META[category];
      return {
        category,
        count,
        label: count === 1 ? meta.singular : meta.plural,
        Icon: meta.Icon,
      };
    });
}

function isToolGroupItem(item: RuntimeChatItem): boolean {
  if (isContextCompactionToolCall(item)) return false;
  if (isPlanProposalToolCall(item)) return false;
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "web_search"
  );
}

function categorizeItem(item: RuntimeChatItem): GroupCategory {
  if (item.type === "command_execution") return "executed";
  if (item.type === "file_change") return "edited";
  if (item.type === "web_search") return "searched";
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  if (!payload) return "other";

  switch (payload.kind) {
    case "read":
      return "viewed";
    case "search":
    case "fetch":
      return "searched";
    case "edit":
    case "delete":
    case "move":
      return "edited";
    case "execute":
      return "executed";
  }

  const byName = categorizeToolName(payload.name ?? "");
  if (byName !== "other") return byName;
  return categorizeVerbPrefix(payload.name ?? "");
}

function categorizeToolName(name: string): GroupCategory {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "viewed";
    case "Grep":
    case "Glob":
    case "LS":
    case "List":
    case "WebSearch":
    case "WebFetch":
    case "ToolSearch":
      return "searched";
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
    case "Patch":
      return "edited";
    case "Bash":
    case "BashOutput":
    case "KillBash":
    case "KillShell":
      return "executed";
    default:
      return "other";
  }
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

function categorizeVerbPrefix(name: string): GroupCategory {
  const t = name.toLowerCase().trim();
  if (t.startsWith("viewing") || t.startsWith("reading") || t.startsWith("read ")) return "viewed";
  if (
    t.startsWith("searching") ||
    t.startsWith("finding") ||
    t.startsWith("grep") ||
    t.startsWith("listing") ||
    t.startsWith("fetch")
  ) {
    return "searched";
  }
  if (
    t.startsWith("editing") ||
    t.startsWith("writing") ||
    t.startsWith("patching") ||
    t.startsWith("creating") ||
    t.startsWith("deleting") ||
    t.startsWith("removing")
  ) {
    return "edited";
  }
  if (t.startsWith("running") || t.startsWith("executing") || t.startsWith("shell")) {
    return "executed";
  }
  return "other";
}
