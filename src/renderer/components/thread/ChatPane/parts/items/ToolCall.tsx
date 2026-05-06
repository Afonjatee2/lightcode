import { memo, useMemo, useState } from "react";
import {
  Download,
  Eye,
  FilePlus,
  FolderSearch,
  Globe,
  Pencil,
  Plug,
  SearchCode,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { ChatItemAccordion } from "./ChatItemAccordion";
import { ContextCompaction, isContextCompactionToolCall } from "./ContextCompaction";
import { ToolCallSections, type ToolCallSection } from "./ToolCallSections";
import { extractAcpArgsPart, extractAcpResultPart } from "./acpToolPayload";

interface ToolCallProps {
  item: RuntimeChatItem;
}

export const ToolCall = memo(function ToolCall({ item }: ToolCallProps) {
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  const [isExpanded, setIsExpanded] = useState(false);
  const sections = useMemo<ToolCallSection[]>(() => {
    if (!isExpanded || !payload) return [];
    return [
      { label: "args", part: extractAcpArgsPart(payload) },
      { label: "result", part: extractAcpResultPart(payload) },
    ];
  }, [isExpanded, payload]);
  if (!payload?.name) return null;
  if (isContextCompactionToolCall(item)) return <ContextCompaction item={item} />;
  const hasDetails = payload.args !== undefined || payload.result !== undefined;
  const Icon = pickToolIcon(payload);
  const errorLabel = payload.status === "error" ? "error" : undefined;

  return (
    <ChatItemAccordion
      icon={<Icon className="size-3" />}
      title={payload.name}
      rightLabel={errorLabel}
      rightLabelClassName="text-danger"
      hasBody={hasDetails}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      <ToolCallSections sections={sections} />
    </ChatItemAccordion>
  );
});

/**
 * Pick an icon based on the tool's title / name. ACP-speaking agents emit
 * human-readable titles like `Viewing src/foo.ts` or `Searching for 'bar'`,
 * so we match common verb prefixes. MCP tools are detected by their
 * `<server>-mcp-server-<tool>` / `mcp__server__tool` shape (or the explicit
 * `serverId` field) regardless of verb.
 */
export function pickToolIcon(payload: ToolCallPayload): LucideIcon {
  if (isMcpTool(payload)) return Plug;
  const t = payload.name.toLowerCase().trim();
  if (t.startsWith("viewing") || t.startsWith("reading") || t.startsWith("read ")) return Eye;
  if (t.startsWith("finding files") || t.startsWith("listing")) return FolderSearch;
  if (t.startsWith("searching for") || t.startsWith("grep") || t.startsWith("searching"))
    return SearchCode;
  if (
    t.startsWith("web search") ||
    t.startsWith("searching the web") ||
    t.startsWith("fetch") ||
    t.startsWith("downloading")
  )
    return t.startsWith("download") ? Download : Globe;
  if (t.startsWith("editing") || t.startsWith("writing") || t.startsWith("patching")) return Pencil;
  if (t.startsWith("creating") || t.startsWith("adding file")) return FilePlus;
  if (t.startsWith("deleting") || t.startsWith("removing")) return Trash2;
  if (t.startsWith("running") || t.startsWith("executing") || t.startsWith("shell"))
    return Terminal;
  return Wrench;
}

function isMcpTool(payload: ToolCallPayload): boolean {
  if (payload.serverId && payload.serverId.length > 0) return true;
  const n = payload.name;
  return /(^mcp__|-mcp-server-|^mcp[-_])/i.test(n);
}
