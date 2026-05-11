/**
 * Codex app-server → canonical RuntimeEvent mapper.
 *
 * Codex app-server JSON-RPC notifications mapped to Lightcode's canonical
 * runtime-event vocabulary. The shape we emit is intentionally small, based on
 * our `CanonicalItemType` / `RuntimeContentStreamKind` unions.
 *
 * Codex's actual notification vocabulary (relevant subset):
 *   - `turn/started`, `turn/completed`, `turn/aborted`
 *   - `item/started`           — lifecycle, payload `{ item: { id, type, ... } }`
 *   - `item/completed`         — lifecycle, payload `{ item: { id, ... } }`
 *   - `item/agentMessage/delta`           → assistant_text delta
 *   - `item/reasoning/textDelta`          → reasoning_text delta
 *   - `item/reasoning/summaryTextDelta`   → reasoning_text delta
 *   - `item/commandExecution/outputDelta` → command_output delta
 *   - `item/fileChange/outputDelta`       → file_change_output delta
 *   - `item/plan/delta`                   → plan_text delta
 *
 * Approval requests (`item/.../requestApproval`) are JSON-RPC requests, not
 * notifications, and surface via `onServerRequest`. We do not handle them here.
 */

import { randomUUID } from "node:crypto";
import type { CanonicalItemType, RuntimeContentStreamKind, RuntimeEvent } from "@/shared/contracts";
import { extractLeadingPath } from "@/shared/extractLeadingPath";
import { readDiffSummary } from "../fileChangeSummary";

export interface CodexMapperState {
  threadId: string;
  /** Most recent turn id reported via `turn.started`. */
  currentTurnId?: string;
  /** Open assistant_message item id, if any (closed on `turn/completed`). */
  openAssistantItemId?: string;
  /** Map Codex `itemId` → our internal item id. */
  itemIdMap: Map<string, string>;
  /** Map Codex `itemId` → canonical type, for routing deltas + completions. */
  itemTypeMap: Map<string, CanonicalItemType>;
  /** Command items that already streamed outputDelta; used to avoid duplicate aggregated output. */
  commandOutputSeenSet: Set<string>;
  /** Accumulated file-change output, used when Codex reports the path there. */
  fileChangeOutputMap: Map<string, string>;
  /** Last path emitted for a file-change item, to avoid duplicate updates. */
  fileChangePathMap: Map<string, string>;
}

export function createCodexMapperState(threadId: string): CodexMapperState {
  return {
    threadId,
    itemIdMap: new Map(),
    itemTypeMap: new Map(),
    commandOutputSeenSet: new Set(),
    fileChangeOutputMap: new Map(),
    fileChangePathMap: new Map(),
  };
}

export function newItemId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Normalize Codex's item-type label into our canonical enum: lowercase, split
 * camelCase, then keyword match.
 */
export function canonicalTypeFor(raw: string | undefined | null): CanonicalItemType {
  const type = normalizeItemType(raw);
  if (!type) return "tool_call";
  if (type.includes("user")) return "user_message";
  if (type.includes("agent message") || type.includes("assistant")) return "assistant_message";
  if (type.includes("reasoning") || type.includes("thought")) return "reasoning";
  if (type.includes("plan") || type.includes("todo")) return "plan";
  if (type.includes("command")) return "command_execution";
  if (type.includes("file change") || type.includes("patch") || type.includes("edit"))
    return "file_change";
  if (type.includes("web search")) return "web_search";
  if (type.includes("mcp") || type.includes("tool") || type.includes("dynamic")) return "tool_call";
  if (type.includes("error")) return "error";
  return "tool_call";
}

function normalizeItemType(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function streamForType(
  type: CanonicalItemType,
): "assistant_text" | "reasoning_text" | undefined {
  if (type === "assistant_message") return "assistant_text";
  if (type === "reasoning") return "reasoning_text";
  return undefined;
}

/**
 * Map a streaming-delta method name to its content stream kind.
 */
function contentStreamForMethod(method: string): RuntimeContentStreamKind | undefined {
  switch (method) {
    case "item/agentMessage/delta":
      return "assistant_text";
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
      return "reasoning_text";
    case "item/commandExecution/outputDelta":
      return "command_output";
    case "item/fileChange/outputDelta":
      return "file_change_output";
    case "item/plan/delta":
      return "plan_text";
    default:
      return undefined;
  }
}

export interface CodexItemPayload {
  id?: string;
  type?: string;
  kind?: string;
  text?: string;
  title?: string;
  name?: string;
  command?: string;
  aggregatedOutput?: string | null;
  formattedOutput?: string | null;
  cwd?: string;
  path?: string;
  file_path?: string;
  filePath?: string;
  relative_path?: string;
  relativePath?: string;
  notebook_path?: string;
  query?: string;
  exitCode?: number;
  durationMs?: number;
  status?: string;
  changeKind?: string;
  changes?: unknown;
  content?: unknown;
  /** Generic tool input (codex `mcp` / `dynamic` tool items). */
  input?: unknown;
  args?: unknown;
  /** Generic tool output. */
  output?: unknown;
  result?: unknown;
  /** Web search may carry a results array. */
  results?: unknown;
}

function readItem(params: Record<string, unknown> | undefined): CodexItemPayload | undefined {
  if (!params) return undefined;
  if (params.item && typeof params.item === "object") {
    return params.item as CodexItemPayload;
  }
  return params as CodexItemPayload;
}

function readTurnId(params: Record<string, unknown> | undefined): string | undefined {
  if (params && typeof params.turnId === "string") return params.turnId;
  const turn = params?.turn;
  if (turn && typeof turn === "object") {
    const value = (turn as Record<string, unknown>).id;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readItemId(
  params: Record<string, unknown> | undefined,
  fallback?: CodexItemPayload,
): string | undefined {
  if (params && typeof params.itemId === "string") return params.itemId;
  if (fallback && typeof fallback.id === "string") return fallback.id;
  return undefined;
}

function isInterruptedTurn(params: Record<string, unknown> | undefined): boolean {
  const turn = params?.turn;
  if (!turn || typeof turn !== "object" || !("status" in turn)) return false;
  return (turn as Record<string, unknown>).status === "interrupted";
}

export function mapCodexNotification(
  method: string,
  params: Record<string, unknown> | undefined,
  state: CodexMapperState,
): RuntimeEvent[] {
  const { threadId } = state;

  if (method === "turn/started") {
    const turnId = readTurnId(params) ?? `t-${Date.now()}`;
    state.currentTurnId = turnId;
    return [{ type: "turn.started", threadId, turnId }];
  }

  if (method === "turn/completed" || method === "turn/aborted") {
    const events: RuntimeEvent[] = [];
    if (state.openAssistantItemId) {
      events.push({
        type: "item.completed",
        threadId,
        itemId: state.openAssistantItemId,
      });
      delete state.openAssistantItemId;
    }
    const turnId = state.currentTurnId ?? readTurnId(params) ?? `t-${Date.now()}`;
    events.push({
      type: "turn.completed",
      threadId,
      turnId,
      state: method === "turn/aborted" || isInterruptedTurn(params) ? "interrupted" : "completed",
    });
    delete state.currentTurnId;
    state.itemIdMap.clear();
    state.itemTypeMap.clear();
    state.commandOutputSeenSet.clear();
    state.fileChangeOutputMap.clear();
    state.fileChangePathMap.clear();
    return events;
  }

  if (method === "thread/error") {
    const message = String((params?.message as string | undefined) ?? "Codex thread error");
    return [{ type: "error", threadId, message }];
  }

  if (method === "item/started") {
    const item = readItem(params);
    const codexItemId = readItemId(params, item);
    if (!item || !codexItemId) return [];
    if (state.itemIdMap.has(codexItemId)) return [];
    const itemType = canonicalTypeFor(item.type ?? item.kind);
    // `CodexStructuredSession.startTurn` emits the user bubble before `turn/start`;
    // Codex echoes a user item here too — skip to avoid duplicate rows.
    if (itemType === "user_message") return [];
    const internalId = newItemId(itemType);
    state.itemIdMap.set(codexItemId, internalId);
    state.itemTypeMap.set(codexItemId, itemType);
    if (itemType === "assistant_message") state.openAssistantItemId = internalId;
    const events: RuntimeEvent[] = [
      {
        type: "item.started",
        threadId,
        itemId: internalId,
        itemType,
        payload: buildStartedPayload(itemType, item),
      },
    ];
    const initialText = extractMessageText(item);
    const stream = streamForType(itemType);
    if (initialText.length > 0 && stream) {
      events.push({
        type: "content.delta",
        threadId,
        itemId: internalId,
        stream,
        delta: initialText,
      });
    }
    return events;
  }

  if (method === "item/completed") {
    const item = readItem(params);
    const codexItemId = readItemId(params, item);
    if (!item || !codexItemId) return [];
    const internalId = state.itemIdMap.get(codexItemId);
    if (!internalId) {
      // Item completed without us seeing started — synthesize both so the chat
      // doesn't lose the message.
      const itemType = canonicalTypeFor(item.type ?? item.kind);
      if (itemType === "user_message") return [];
      const fresh = newItemId(itemType);
      state.itemIdMap.set(codexItemId, fresh);
      state.itemTypeMap.set(codexItemId, itemType);
      const events: RuntimeEvent[] = [
        {
          type: "item.started",
          threadId,
          itemId: fresh,
          itemType,
          payload: buildStartedPayload(itemType, item),
        },
      ];
      const finalText = extractMessageText(item);
      const stream = streamForType(itemType);
      if (finalText.length > 0 && stream) {
        events.push({
          type: "content.delta",
          threadId,
          itemId: fresh,
          stream,
          delta: finalText,
        });
      }
      const aggregatedCommandOutput = readCommandAggregatedOutput(itemType, item);
      if (aggregatedCommandOutput) {
        events.push({
          type: "content.delta",
          threadId,
          itemId: fresh,
          stream: "command_output",
          delta: aggregatedCommandOutput,
        });
      }
      const completedPayload = buildCompletedPayload(itemType, item);
      events.push({
        type: "item.completed",
        threadId,
        itemId: fresh,
        ...(completedPayload ? { payload: completedPayload } : {}),
      });
      state.itemIdMap.delete(codexItemId);
      state.itemTypeMap.delete(codexItemId);
      state.commandOutputSeenSet.delete(codexItemId);
      state.fileChangeOutputMap.delete(codexItemId);
      state.fileChangePathMap.delete(codexItemId);
      return events;
    }
    const itemType = state.itemTypeMap.get(codexItemId) ?? canonicalTypeFor(item.type ?? item.kind);
    state.itemIdMap.delete(codexItemId);
    state.itemTypeMap.delete(codexItemId);
    if (state.openAssistantItemId === internalId) delete state.openAssistantItemId;
    const events: RuntimeEvent[] = [];
    if (itemType === "assistant_message" || itemType === "user_message") {
      const finalText = extractMessageText(item);
      if (finalText.length > 0) {
        events.push({
          type: "item.updated",
          threadId,
          itemId: internalId,
          payload: { content: [{ kind: "text", text: finalText }] },
        });
      }
    }
    const aggregatedCommandOutput = state.commandOutputSeenSet.has(codexItemId)
      ? undefined
      : readCommandAggregatedOutput(itemType, item);
    if (aggregatedCommandOutput) {
      events.push({
        type: "content.delta",
        threadId,
        itemId: internalId,
        stream: "command_output",
        delta: aggregatedCommandOutput,
      });
    }
    const completedPayload = buildCompletedPayload(itemType, item);
    events.push({
      type: "item.completed",
      threadId,
      itemId: internalId,
      ...(completedPayload ? { payload: completedPayload } : {}),
    });
    state.commandOutputSeenSet.delete(codexItemId);
    state.fileChangeOutputMap.delete(codexItemId);
    state.fileChangePathMap.delete(codexItemId);
    return events;
  }

  // Streaming deltas: item/<kind>/<event> with `delta` at top level.
  const stream = contentStreamForMethod(method);
  if (stream) {
    const delta = typeof params?.delta === "string" ? params.delta : "";
    if (!delta) return [];
    const codexItemId = readItemId(params);
    if (!codexItemId) return [];
    let internalId = state.itemIdMap.get(codexItemId);
    const opened: RuntimeEvent[] = [];
    if (!internalId) {
      const itemType = canonicalTypeFromStream(stream);
      internalId = newItemId(itemType);
      state.itemIdMap.set(codexItemId, internalId);
      state.itemTypeMap.set(codexItemId, itemType);
      if (itemType === "assistant_message") state.openAssistantItemId = internalId;
      opened.push({
        type: "item.started",
        threadId,
        itemId: internalId,
        itemType,
        payload: buildStartedPayload(itemType, {}),
      });
    }
    if (stream === "file_change_output") {
      const text = (state.fileChangeOutputMap.get(codexItemId) ?? "") + delta;
      state.fileChangeOutputMap.set(codexItemId, text);
      const path = extractCodexFileChangePath(text);
      if (path && state.fileChangePathMap.get(codexItemId) !== path) {
        state.fileChangePathMap.set(codexItemId, path);
        opened.push({
          type: "item.updated",
          threadId,
          itemId: internalId,
          payload: { path },
        });
      }
    } else if (stream === "command_output") {
      state.commandOutputSeenSet.add(codexItemId);
    }
    return [
      ...opened,
      {
        type: "content.delta",
        threadId,
        itemId: internalId,
        stream,
        delta,
      },
    ];
  }

  return [];
}

function canonicalTypeFromStream(stream: RuntimeContentStreamKind): CanonicalItemType {
  switch (stream) {
    case "assistant_text":
      return "assistant_message";
    case "reasoning_text":
      return "reasoning";
    case "plan_text":
      return "plan";
    case "command_output":
      return "command_execution";
    case "file_change_output":
      return "file_change";
  }
}

export function buildStartedPayload(
  itemType: CanonicalItemType,
  source: CodexItemPayload,
): unknown {
  if (itemType === "command_execution") {
    return {
      command: typeof source.command === "string" ? source.command : "",
      ...(typeof source.cwd === "string" ? { cwd: source.cwd } : {}),
      status: "running",
    };
  }
  if (itemType === "file_change") {
    const args = pickToolInput(source);
    const path = extractCodexFileChangePath(source);
    const changesPayload = readChangesPayload(source);
    const diffSummary =
      readCodexChangesDiffSummary(source.changes) ?? readDiffSummary(source, args);
    return {
      path: path ?? "",
      ...(typeof source.title === "string" && source.title.length > 0
        ? { title: source.title }
        : {}),
      ...(typeof source.name === "string" && source.name.length > 0 ? { name: source.name } : {}),
      changeKind: classifyCodexFileChangeKind(source),
      ...(diffSummary ? { diffSummary } : {}),
      ...(args !== undefined
        ? { args }
        : changesPayload !== undefined
          ? { args: changesPayload }
          : {}),
      status: "running" as const,
    };
  }
  if (itemType === "web_search") {
    return {
      query:
        typeof source.query === "string"
          ? source.query
          : typeof source.text === "string"
            ? source.text
            : "",
      ...(toolName(source) ? { name: toolName(source) } : {}),
      status: "running" as const,
    };
  }
  if (itemType === "assistant_message" || itemType === "user_message") {
    const text = extractMessageText(source);
    return { content: text.length > 0 ? [{ kind: "text", text }] : [] };
  }
  if (itemType === "tool_call") {
    const args = pickToolInput(source);
    return {
      name: toolName(source) ?? "tool",
      ...(args !== undefined ? { args } : {}),
      status: "running" as const,
    };
  }
  if (itemType === "plan") return { steps: [] };
  if (itemType === "reasoning") return {};
  return undefined;
}

export function buildCompletedPayload(
  itemType: CanonicalItemType,
  source: CodexItemPayload,
): unknown {
  if (itemType === "command_execution") {
    return {
      ...(typeof source.status === "string"
        ? { status: source.status === "failed" ? "error" : "success" }
        : {}),
      ...(typeof source.exitCode === "number" ? { exitCode: source.exitCode } : {}),
      ...(typeof source.durationMs === "number" ? { durationMs: source.durationMs } : {}),
    };
  }
  if (itemType === "tool_call") {
    const result = pickToolOutput(source);
    return {
      status: codexFinalStatus(source.status),
      ...(result !== undefined ? { result } : {}),
    };
  }
  if (itemType === "file_change") {
    const result = pickToolOutput(source);
    const path = extractCodexFileChangePath(source);
    const changesPayload = readChangesPayload(source);
    const diffSummary =
      readCodexChangesDiffSummary(source.changes) ?? readDiffSummary(source, result);
    return {
      ...(path ? { path } : {}),
      ...(typeof source.title === "string" && source.title.length > 0
        ? { title: source.title }
        : {}),
      ...(typeof source.name === "string" && source.name.length > 0 ? { name: source.name } : {}),
      changeKind: classifyCodexFileChangeKind(source),
      ...(diffSummary ? { diffSummary } : {}),
      status: codexFinalStatus(source.status),
      ...(result !== undefined
        ? { result }
        : changesPayload !== undefined
          ? { result: changesPayload }
          : {}),
    };
  }
  if (itemType === "web_search") {
    const result = pickToolOutput(source);
    const resultCount = countWebSearchResults(source);
    return {
      status: codexFinalStatus(source.status),
      ...(resultCount != null ? { resultCount } : {}),
      ...(result !== undefined ? { result } : {}),
    };
  }
  return undefined;
}

function readCommandAggregatedOutput(
  itemType: CanonicalItemType,
  source: CodexItemPayload,
): string | undefined {
  if (itemType !== "command_execution") return undefined;
  if (typeof source.aggregatedOutput === "string" && source.aggregatedOutput.length > 0) {
    return source.aggregatedOutput;
  }
  if (typeof source.formattedOutput === "string" && source.formattedOutput.length > 0) {
    return source.formattedOutput;
  }
  return undefined;
}

function codexFinalStatus(raw: unknown): "success" | "error" {
  return typeof raw === "string" && (raw === "failed" || raw === "error") ? "error" : "success";
}

/**
 * Pick the tool's request payload from a codex item. Codex's per-tool item
 * shapes vary (`mcp`, `dynamic`, plus user-defined custom tools), so we accept
 * the common aliases — `args` / `input` — without inventing new ones.
 */
function pickToolInput(source: CodexItemPayload): unknown {
  if (source.args !== undefined) return source.args;
  if (source.input !== undefined) return source.input;
  return undefined;
}

function pickToolOutput(source: CodexItemPayload): unknown {
  if (source.result !== undefined) return source.result;
  if (source.output !== undefined) return source.output;
  return undefined;
}

function extractCodexFileChangePath(source: CodexItemPayload | unknown): string | undefined {
  if (source && typeof source === "object") {
    const record = source as Record<string, unknown>;
    const direct = readPathField(record);
    if (direct) return direct;
    const changesPath = readFirstCodexChangePath(record.changes);
    if (changesPath) return changesPath;
    return (
      extractCodexFileChangePath(record.args) ??
      extractCodexFileChangePath(record.input) ??
      extractCodexFileChangePath(record.output) ??
      extractCodexFileChangePath(record.result) ??
      extractTitlePath(record.title) ??
      extractTitlePath(record.name)
    );
  }
  if (typeof source !== "string") return undefined;

  const patchPath = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+?)\s*$/m.exec(source);
  if (patchPath?.[1]) return patchPath[1].trim();

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fileListStart = lines.findIndex((line) => /following files:/i.test(line));
  if (fileListStart === -1) return undefined;
  for (const line of lines.slice(fileListStart + 1)) {
    const path = /^[A-Z?]\s+(.+)$/.exec(line)?.[1] ?? (/^[A-Z?]$/.test(line) ? undefined : line);
    if (path) return path.trim();
  }
  return undefined;
}

function readChangesPayload(source: CodexItemPayload): unknown {
  return source.changes !== undefined ? { changes: source.changes } : undefined;
}

function readFirstCodexChangePath(changes: unknown): string | undefined {
  if (!Array.isArray(changes)) return undefined;
  for (const change of changes) {
    if (!change || typeof change !== "object") continue;
    const record = change as Record<string, unknown>;
    const movePath = readCodexChangeMovePath(record.kind);
    if (movePath) return movePath;
    const path = readPathField(record);
    if (path) return path;
  }
  return undefined;
}

function readCodexChangeMovePath(kind: unknown): string | undefined {
  if (!kind || typeof kind !== "object") return undefined;
  const value = (kind as Record<string, unknown>).move_path;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPathField(record: Record<string, unknown>): string | undefined {
  const keys = [
    "path",
    "file_path",
    "filePath",
    "filepath",
    "relative_path",
    "relativePath",
    "notebook_path",
    "notebookPath",
  ];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function extractTitlePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const leading = extractLeadingPath(value);
  if (leading) return leading;
  const writingTarget = /\b(?:to|file)\s+([^\s]+\.[^\s:]+)(?::|\s|$)/i.exec(value);
  return writingTarget?.[1]?.trim();
}

function toolName(source: CodexItemPayload): string | undefined {
  if (typeof source.title === "string" && source.title.length > 0) return source.title;
  if (typeof source.name === "string" && source.name.length > 0) return source.name;
  if (typeof source.type === "string" && source.type.length > 0) return source.type;
  return undefined;
}

/**
 * Classify a codex `fileChange` item into create / edit / delete. Codex carries
 * the kind on `item.changeKind` (preferred) or implicitly through `item.kind`
 * / `item.type`; older shapes don't tell us, so default to `edit` to match
 * historical behavior.
 */
function classifyCodexFileChangeKind(source: CodexItemPayload): "create" | "edit" | "delete" {
  const direct = String(source.changeKind ?? "").toLowerCase();
  if (direct === "create" || direct === "add") return "create";
  if (direct === "delete" || direct === "remove") return "delete";
  if (direct === "edit" || direct === "update" || direct === "modify") return "edit";

  const changesKind = classifyCodexChangesKind(source.changes);
  if (changesKind) return changesKind;

  const kind = String(source.kind ?? "").toLowerCase();
  if (/\b(create|add)\b/.test(kind)) return "create";
  if (/\b(delete|remove|rm)\b/.test(kind)) return "delete";

  const type = String(source.type ?? "").toLowerCase();
  if (/create|add/.test(type)) return "create";
  if (/delete|remove/.test(type)) return "delete";

  return "edit";
}

function classifyCodexChangesKind(changes: unknown): "create" | "edit" | "delete" | undefined {
  if (!Array.isArray(changes) || changes.length === 0) return undefined;
  const kinds = changes
    .map((change) => {
      if (!change || typeof change !== "object") return undefined;
      const kind = (change as Record<string, unknown>).kind;
      if (!kind || typeof kind !== "object") return undefined;
      const type = String((kind as Record<string, unknown>).type ?? "").toLowerCase();
      if (type === "add" || type === "create") return "create" as const;
      if (type === "delete" || type === "remove") return "delete" as const;
      if (type === "update" || type === "modify" || type === "move") return "edit" as const;
      return undefined;
    })
    .filter((kind): kind is "create" | "edit" | "delete" => kind !== undefined);
  if (kinds.length === 0) return undefined;
  return kinds.every((kind) => kind === kinds[0]) ? kinds[0] : "edit";
}

function readCodexChangesDiffSummary(
  changes: unknown,
): { added: number; removed: number } | undefined {
  if (!Array.isArray(changes)) return undefined;
  let added = 0;
  let removed = 0;
  let sawDiff = false;
  for (const change of changes) {
    if (!change || typeof change !== "object") continue;
    const diff = (change as Record<string, unknown>).diff;
    if (typeof diff !== "string" || diff.length === 0) continue;
    sawDiff = true;
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return sawDiff ? { added, removed } : undefined;
}

/** Count results when the web_search item carries a structured `results` array. */
function countWebSearchResults(source: CodexItemPayload): number | undefined {
  if (Array.isArray(source.results)) return source.results.length;
  if (Array.isArray(source.content)) return source.content.length;
  return undefined;
}

/**
 * Pull plain text out of a Codex message item. Codex 0.122+ packs text into
 * `content` as an array of `{ type: "text", text }` blocks; older shapes set
 * `item.text` directly.
 */
export function extractMessageText(item: CodexItemPayload): string {
  if (typeof item.text === "string" && item.text.length > 0) return item.text;
  if (Array.isArray(item.content)) {
    const parts: string[] = [];
    for (const block of item.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
    if (parts.length > 0) return parts.join("");
  }
  return "";
}
