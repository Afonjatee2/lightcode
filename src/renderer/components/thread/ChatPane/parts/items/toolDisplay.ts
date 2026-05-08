import {
  Bot,
  Download,
  Eye,
  FilePlus,
  FolderSearch,
  Globe,
  Pencil,
  Plug,
  SearchCode,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";

export interface ToolDisplay {
  title: string;
  Icon: LucideIcon;
}

/**
 * Pick a human-readable title and icon for a `tool_call` row.
 *
 * Three input shapes are normalized:
 *   1. Claude SDK raw names (`Read`, `Grep`, `Glob`, `Task`, …) — the title is
 *      composed from the args (`Read: src/foo.ts`, `Grep: "pattern"`).
 *   2. MCP tools (`mcp__<server>__<tool>` or `<server>-mcp-server-<tool>`) —
 *      shown as `<server>: <tool>` with the Plug icon.
 *   3. ACP-style human-readable titles (`Viewing src/foo.ts`, `Searching for…`)
 *      — the verb prefix selects an icon and the title is passed through.
 */
export function deriveToolDisplay(payload: ToolCallPayload): ToolDisplay {
  const args = readArgsObject(payload);

  const mcp = parseMcpName(payload);
  if (mcp) {
    return { title: formatMcpTitle(mcp), Icon: Plug };
  }

  if (isSkillTool(payload)) {
    const skill = readStr(args, "skill") ?? readStr(args, "name");
    return { title: skill ? `Skill: ${skill}` : payload.name, Icon: Sparkles };
  }

  const claude = mapClaudeRawTool(payload.name, args);
  if (claude) return claude;

  return { title: payload.name, Icon: pickIconByVerbPrefix(payload.name) };
}

function mapClaudeRawTool(
  name: string,
  args: Record<string, unknown> | undefined,
): ToolDisplay | null {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return { title: titleWithPath("Read", args, "file_path", "notebook_path"), Icon: Eye };
    case "Grep":
      return { title: formatGrepTitle(args), Icon: SearchCode };
    case "Glob":
      return { title: titleWithValue("Glob", args, "pattern"), Icon: FolderSearch };
    case "LS":
    case "List":
      return { title: titleWithPath("List", args, "path"), Icon: FolderSearch };
    case "Task":
    case "Agent":
      return { title: formatAgentTitle(args), Icon: Bot };
    case "BashOutput":
      return { title: titleWithValue("Bash output", args, "bash_id"), Icon: Terminal };
    case "KillBash":
    case "KillShell":
      return { title: titleWithValue("Kill bash", args, "shell_id", "bash_id"), Icon: Terminal };
    case "ExitPlanMode":
      return { title: "Exit plan mode", Icon: Wrench };
    case "EnterPlanMode":
      return { title: "Enter plan mode", Icon: Wrench };
    case "WebFetch":
      return { title: titleWithValue("Fetch", args, "url"), Icon: Globe };
    case "WebSearch":
      return { title: titleWithValue("Web search", args, "query"), Icon: Globe };
    case "ToolSearch":
      return { title: titleWithValue("Tool search", args, "query"), Icon: SearchCode };
    case "TaskCreate":
      return { title: titleWithValue("Create task", args, "description"), Icon: FilePlus };
    case "TaskList":
      return { title: "List tasks", Icon: FolderSearch };
    case "TaskGet":
      return { title: titleWithValue("Get task", args, "id"), Icon: Eye };
    case "TaskUpdate":
      return { title: titleWithValue("Update task", args, "id"), Icon: Pencil };
    case "TaskOutput":
      return { title: titleWithValue("Task output", args, "id"), Icon: Terminal };
    case "TaskStop":
      return { title: titleWithValue("Stop task", args, "id"), Icon: Trash2 };
    default:
      return null;
  }
}

function readArgsObject(payload: ToolCallPayload): Record<string, unknown> | undefined {
  const a = payload.args;
  if (!a || typeof a !== "object" || Array.isArray(a)) return undefined;
  return a as Record<string, unknown>;
}

function readStr(args: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function titleWithPath(
  verb: string,
  args: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  const path = readStr(args, ...keys);
  return path ? `${verb}: ${path}` : verb;
}

function titleWithValue(
  verb: string,
  args: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  const value = readStr(args, ...keys);
  return value ? `${verb}: ${value}` : verb;
}

function formatGrepTitle(args: Record<string, unknown> | undefined): string {
  const pattern = readStr(args, "pattern");
  if (!pattern) return "Grep";
  const path = readStr(args, "path");
  const glob = readStr(args, "glob");
  const scope = path ?? glob;
  return scope ? `Grep: "${pattern}" in ${scope}` : `Grep: "${pattern}"`;
}

function formatAgentTitle(args: Record<string, unknown> | undefined): string {
  const description = readStr(args, "description");
  const subagent = readStr(args, "subagent_type");
  if (description) {
    return subagent ? `Agent (${subagent}): ${description}` : `Agent: ${description}`;
  }
  return subagent ? `Agent: ${subagent}` : "Agent";
}

interface McpInfo {
  server: string;
  tool: string;
}

function parseMcpName(payload: ToolCallPayload): McpInfo | null {
  const m1 = /^mcp__(.+?)__(.+)$/.exec(payload.name);
  if (m1) return { server: m1[1]!, tool: m1[2]! };
  const m2 = /^(.+?)-mcp-server-(.+)$/.exec(payload.name);
  if (m2) return { server: m2[1]!, tool: m2[2]! };
  if (payload.serverId && payload.serverId.length > 0) {
    return { server: payload.serverId, tool: payload.name };
  }
  return null;
}

function formatMcpTitle(info: McpInfo): string {
  return `${prettyMcpServer(info.server)}: ${info.tool}`;
}

/**
 * Strip common namespace prefixes that the host injects on every server name
 * (`claude_ai_<Name>`, `plugin_<vendor>_<plugin>`) and replace remaining
 * underscores with spaces so the title reads as a label, not an identifier.
 */
function prettyMcpServer(s: string): string {
  const core = s.replace(/^claude_ai_/, "").replace(/^plugin_[^_]+_/, "");
  return core.replace(/_/g, " ");
}

function isSkillTool(payload: ToolCallPayload): boolean {
  const n = payload.name.trim();
  if (n === "Skill" || /^(loaded|using) skill\b/i.test(n)) return true;
  const args = readArgsObject(payload);
  return readStr(args, "skill") !== undefined;
}

/**
 * Verb-prefix icon resolver for ACP-style human-readable titles
 * (`Viewing src/foo.ts`, `Searching for 'bar'`). Used as a fallback for
 * payloads that don't match an MCP, Skill, or Claude raw shape.
 */
function pickIconByVerbPrefix(name: string): LucideIcon {
  const t = name.toLowerCase().trim();
  if (t.startsWith("viewing") || t.startsWith("reading") || t.startsWith("read ")) return Eye;
  if (t.startsWith("finding files") || t.startsWith("listing")) return FolderSearch;
  if (t.startsWith("searching for") || t.startsWith("grep") || t.startsWith("searching")) {
    return SearchCode;
  }
  if (t.startsWith("downloading") || t.startsWith("download ")) return Download;
  if (t.startsWith("web search") || t.startsWith("searching the web") || t.startsWith("fetch")) {
    return Globe;
  }
  if (t.startsWith("editing") || t.startsWith("writing") || t.startsWith("patching")) return Pencil;
  if (t.startsWith("creating") || t.startsWith("adding file")) return FilePlus;
  if (t.startsWith("deleting") || t.startsWith("removing")) return Trash2;
  if (t.startsWith("running") || t.startsWith("executing") || t.startsWith("shell")) {
    return Terminal;
  }
  return Wrench;
}
