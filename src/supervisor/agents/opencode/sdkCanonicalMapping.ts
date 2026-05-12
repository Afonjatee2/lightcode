/**
 * OpenCode SDK → canonical RuntimeEvent mapper.
 *
 * Translates events emitted by `client.event.subscribe` (`@opencode-ai/sdk/v2`)
 * into Lightcode's canonical chat events. Mirrors the role of
 * `acp/canonicalMapping.ts` for the ACP protocol.
 *
 * Reconciliation note: OpenCode interleaves `message.part.delta` (incremental)
 * with `message.part.updated` (full part snapshot). To avoid double-emit we
 * track the text we have already streamed per part-id and use
 * `suffixPrefixOverlap` to detect what's new in a snapshot.
 */

import { randomUUID } from "node:crypto";
import type {
  EventSubscribeResponse,
  Part,
  PermissionRequest,
  QuestionRequest,
  ToolState,
} from "@opencode-ai/sdk/v2";
import type { CanonicalItemType, CanonicalRequestType, RuntimeEvent } from "@/shared/contracts";
import { readDiffSummary, readFileChangePath } from "../fileChangeSummary";
import {
  createContextUsageEvent,
  readNonNegativeInteger,
  usageFromTokenCounts,
} from "../contextUsage";

export interface OpenCodeMapperState {
  threadId: string;
  /** Map AssistantMessage.id → canonical assistant item id. */
  assistantItems: Map<string, string>;
  /** Map UserMessage.id → canonical user item id. */
  userItems: Map<string, string>;
  /** Map reasoning Part.id → canonical reasoning item id + parent messageID. */
  reasoningItems: Map<string, { itemId: string; messageID: string }>;
  /** Map tool Part.id → { itemId, itemType }. */
  toolItems: Map<string, { itemId: string; itemType: CanonicalItemType }>;
  /**
   * Map Part.id → its type, set by `message.part.updated`. Used to route
   * incoming `message.part.delta` events: OpenCode emits `field: "text"` for
   * both `TextPart` and `ReasoningPart` deltas (the field is the property
   * name on the part — and `ReasoningPart.text` collides with `TextPart.text`),
   * so the field alone is ambiguous. The part type tells us which canonical
   * item to append into.
   */
  partTypes: Map<string, "text" | "reasoning">;
  /** Text already emitted as delta per part-id (for snapshot dedup). */
  emittedText: Map<string, string>;
  /** Role for each known Message.id, populated from `message.updated`. */
  messageRoles: Map<string, "user" | "assistant">;
  /**
   * Optimistic user-message item ids handed in by the runtime, queued in the
   * order their `startTurn` calls happened. The next `message.updated` with
   * role=user consumes the head, so the SDK-emitted user message reuses the
   * id the renderer already painted instead of creating a duplicate.
   */
  pendingUserMessageItemIds: string[];
}

export function createOpenCodeMapperState(threadId: string): OpenCodeMapperState {
  return {
    threadId,
    assistantItems: new Map(),
    userItems: new Map(),
    reasoningItems: new Map(),
    toolItems: new Map(),
    partTypes: new Map(),
    emittedText: new Map(),
    messageRoles: new Map(),
    pendingUserMessageItemIds: [],
  };
}

function newItemId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** Longest suffix of `emitted` that is a prefix of `full`. */
function suffixPrefixOverlap(emitted: string, full: string): number {
  const max = Math.min(emitted.length, full.length);
  for (let i = max; i > 0; i -= 1) {
    if (emitted.endsWith(full.slice(0, i))) return i;
  }
  return 0;
}

function classifyToolItemType(toolName: string): CanonicalItemType {
  const n = toolName.toLowerCase();
  // OpenCode's todo tool is named `todowrite` (the legacy `todoread` may also
  // surface). Route both into the canonical `plan` item so the renderer picks
  // it up via `ThreadTodoDock` instead of a generic tool accordion.
  if (n === "todowrite" || n === "todoread") return "plan";
  if (/(^|[_-])bash($|[_-])|(^|[_-])shell($|[_-])|(^|[_-])command($|[_-])/.test(n)) {
    return "command_execution";
  }
  if (/(^|[_-])(edit|write|patch|multiedit)($|[_-])/.test(n)) {
    return "file_change";
  }
  if (/(^|[_-])(webfetch|websearch|search)($|[_-])/.test(n)) {
    return "web_search";
  }
  return "tool_call";
}

/**
 * Extract canonical plan steps from a `todowrite` tool's input. OpenCode's
 * tool input mirrors Claude's: `{ todos: [{ content, status, priority }] }`.
 * Anything we can't recognise is dropped — empty `steps` results in an empty
 * dock entry, which the renderer treats as "no plan yet".
 */
function extractOpenCodePlanSteps(
  input: Record<string, unknown> | undefined,
): Array<{ step: string; status: "pending" | "in_progress" | "completed" }> {
  const todos = input?.todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((todo) => {
    if (!todo || typeof todo !== "object") return [];
    const obj = todo as Record<string, unknown>;
    const step =
      typeof obj.content === "string" && obj.content.trim().length > 0
        ? obj.content.trim()
        : "Task";
    const status =
      obj.status === "completed"
        ? "completed"
        : obj.status === "in_progress"
          ? "in_progress"
          : "pending";
    return [{ step, status }];
  });
}

function toolStateStatus(state: ToolState): "running" | "success" | "error" {
  if (state.status === "completed") return "success";
  if (state.status === "error") return "error";
  return "running";
}

function createOpenCodeContextUsageEvent(
  threadId: string,
  info: unknown,
): RuntimeEvent | undefined {
  if (!info || typeof info !== "object") return undefined;
  const tokens = (info as { tokens?: unknown }).tokens;
  if (!tokens || typeof tokens !== "object") return undefined;
  const obj = tokens as Record<string, unknown>;
  const cache =
    obj.cache && typeof obj.cache === "object" ? (obj.cache as Record<string, unknown>) : {};
  return createContextUsageEvent(
    threadId,
    usageFromTokenCounts({
      inputTokens: readNonNegativeInteger(obj.input),
      outputTokens: readNonNegativeInteger(obj.output),
      thoughtTokens: readNonNegativeInteger(obj.reasoning),
      cachedReadTokens: readNonNegativeInteger(cache.read),
      cachedWriteTokens: readNonNegativeInteger(cache.write),
    }),
  );
}

/**
 * Build the canonical payload for a tool item based on its current state.
 *
 * Mirrors `buildAcpToolCallPayload`: every payload carries `name`/`args`/
 * `status` (and `result` when complete) so the unified accordion body can
 * surface the full request/response, with the canonical type-specific fields
 * (`command`, `path`, `query`, etc.) layered on top for renderers that key off
 * of them.
 */
function toolPayload(
  itemType: CanonicalItemType,
  toolName: string,
  state: ToolState,
): Record<string, unknown> {
  const status = toolStateStatus(state);
  const title =
    "title" in state && typeof state.title === "string" && state.title.length > 0
      ? state.title
      : toolName;
  const result =
    state.status === "completed"
      ? state.output
      : state.status === "error"
        ? state.error
        : undefined;
  const base: Record<string, unknown> = {
    name: title,
    args: state.input,
    status,
    ...(result !== undefined ? { result } : {}),
  };

  if (itemType === "command_execution") {
    const command = typeof state.input?.command === "string" ? state.input.command : "";
    const cwd = typeof state.input?.cwd === "string" ? state.input.cwd : undefined;
    const md =
      (state.status === "completed" || state.status === "error"
        ? (state.metadata as Record<string, unknown> | undefined)
        : undefined) ?? undefined;
    const durationMs =
      (state.status === "completed" || state.status === "error") && state.time?.end !== undefined
        ? state.time.end - state.time.start
        : undefined;
    const exitCode =
      md && typeof md.exit === "number"
        ? (md.exit as number)
        : md && typeof md.exitCode === "number"
          ? (md.exitCode as number)
          : undefined;
    return {
      ...base,
      command,
      ...(cwd ? { cwd } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  }
  if (itemType === "file_change") {
    const path = readFileChangePath(state.input, result, title) ?? "";
    const diffSummary = readDiffSummary(
      state.input,
      result,
      "metadata" in state ? state.metadata : undefined,
    );
    return {
      ...base,
      // OpenCode's edit/write tools overwrite `state.title` on completion
      // with the human-readable result message ("Success. Updated the
      // following files: M src/foo.ts"). The path is extracted separately
      // and rendered as the row title, so anchor `name` to the tool name
      // instead of the polluted title.
      name: toolName,
      path,
      changeKind: /create|write/.test(toolName)
        ? "create"
        : /delete|rm/.test(toolName)
          ? "delete"
          : "edit",
      ...(diffSummary ? { diffSummary } : {}),
    };
  }
  if (itemType === "web_search") {
    const query =
      typeof state.input?.query === "string"
        ? state.input.query
        : typeof state.input?.q === "string"
          ? state.input.q
          : "";
    return { ...base, query };
  }
  if (itemType === "plan") {
    // PlanItemPayload is strictly `{ steps }` — surfacing `name`/`args` here
    // would fail schema validation, so the plan branch returns the canonical
    // shape directly. The dock reads `steps`, the runtime ignores the rest.
    return { steps: extractOpenCodePlanSteps(state.input as Record<string, unknown> | undefined) };
  }
  return base;
}

function ensureAssistantItemForMessage(
  state: OpenCodeMapperState,
  messageID: string,
  events: RuntimeEvent[],
): string {
  const existing = state.assistantItems.get(messageID);
  if (existing) return existing;
  const itemId = newItemId("asst");
  state.assistantItems.set(messageID, itemId);
  events.push({
    type: "item.started",
    threadId: state.threadId,
    itemId,
    itemType: "assistant_message",
  });
  return itemId;
}

function ensureReasoningItemForPart(
  state: OpenCodeMapperState,
  partID: string,
  messageID: string,
  events: RuntimeEvent[],
): string {
  const existing = state.reasoningItems.get(partID);
  if (existing) return existing.itemId;
  const itemId = newItemId("reason");
  state.reasoningItems.set(partID, { itemId, messageID });
  events.push({
    type: "item.started",
    threadId: state.threadId,
    itemId,
    itemType: "reasoning",
  });
  return itemId;
}

function completeReasoningItem(
  state: OpenCodeMapperState,
  partID: string,
  events: RuntimeEvent[],
): void {
  const entry = state.reasoningItems.get(partID);
  if (!entry) return;
  events.push({ type: "item.completed", threadId: state.threadId, itemId: entry.itemId });
  state.reasoningItems.delete(partID);
}

function emitTextDelta(
  state: OpenCodeMapperState,
  partID: string,
  itemId: string,
  full: string,
  stream: "assistant_text" | "reasoning_text",
  events: RuntimeEvent[],
): void {
  const emitted = state.emittedText.get(partID) ?? "";
  if (emitted === full) return;
  if (full.startsWith(emitted)) {
    const tail = full.slice(emitted.length);
    if (tail.length === 0) return;
    state.emittedText.set(partID, full);
    events.push({
      type: "content.delta",
      threadId: state.threadId,
      itemId,
      stream,
      delta: tail,
    });
    return;
  }
  // Snapshot diverged — use overlap to find the new tail.
  const overlap = suffixPrefixOverlap(emitted, full);
  const tail = full.slice(overlap);
  state.emittedText.set(partID, emitted + tail);
  if (tail.length > 0) {
    events.push({
      type: "content.delta",
      threadId: state.threadId,
      itemId,
      stream,
      delta: tail,
    });
  }
}

function appendDelta(
  state: OpenCodeMapperState,
  partID: string,
  itemId: string,
  delta: string,
  stream: "assistant_text" | "reasoning_text",
  events: RuntimeEvent[],
): void {
  if (delta.length === 0) return;
  const emitted = state.emittedText.get(partID) ?? "";
  state.emittedText.set(partID, emitted + delta);
  events.push({
    type: "content.delta",
    threadId: state.threadId,
    itemId,
    stream,
    delta,
  });
}

function handlePart(state: OpenCodeMapperState, part: Part, events: RuntimeEvent[]): void {
  if (part.type === "text") {
    if (part.synthetic || part.ignored) return;
    // The optimistic user_message painted by the runtime already carries the
    // prompt text. OpenCode echoes the same text back as a TextPart on the
    // user message — emitting it as assistant text would mirror the prompt
    // into a phantom assistant bubble.
    if (state.messageRoles.get(part.messageID) === "user") return;
    state.partTypes.set(part.id, "text");
    const itemId = ensureAssistantItemForMessage(state, part.messageID, events);
    emitTextDelta(state, part.id, itemId, part.text, "assistant_text", events);
    return;
  }
  if (part.type === "reasoning") {
    if (state.messageRoles.get(part.messageID) === "user") return;
    state.partTypes.set(part.id, "reasoning");
    const itemId = ensureReasoningItemForPart(state, part.id, part.messageID, events);
    emitTextDelta(state, part.id, itemId, part.text, "reasoning_text", events);
    // OpenCode flags reasoning completion via `time.end`. Without this close
    // the renderer's Reasoning component stays in its "Thinking" state for
    // the rest of the thread (item.state !== "completed").
    if (part.time?.end !== undefined) {
      completeReasoningItem(state, part.id, events);
      state.emittedText.delete(part.id);
    }
    return;
  }
  if (part.type === "tool") {
    const existing = state.toolItems.get(part.id);
    const itemType = existing?.itemType ?? classifyToolItemType(part.tool);
    const itemId = existing?.itemId ?? newItemId("tool");
    const payload = toolPayload(itemType, part.tool, part.state);
    if (!existing) {
      state.toolItems.set(part.id, { itemId, itemType });
      events.push({
        type: "item.started",
        threadId: state.threadId,
        itemId,
        itemType,
        payload,
      });
    } else {
      events.push({
        type: "item.updated",
        threadId: state.threadId,
        itemId,
        payload,
      });
    }
    if (part.state.status === "completed" || part.state.status === "error") {
      events.push({
        type: "item.completed",
        threadId: state.threadId,
        itemId,
        payload,
      });
    }
    return;
  }
  // file / step-start / step-finish / patch / agent / retry / compaction /
  // subtask / snapshot — not surfaced as their own canonical items in this
  // pass. They are observable via message.updated payloads or downstream
  // dedicated UI surfaces.
}

function classifyPermissionRequestType(req: PermissionRequest): CanonicalRequestType {
  switch (req.permission) {
    case "bash":
      return "command_execution_approval";
    case "edit":
      return "file_change_approval";
    case "read":
      return "file_change_approval";
    default:
      return "tool_user_input";
  }
}

function permissionRequestPayload(req: PermissionRequest): {
  summary: string;
  details: unknown;
} {
  const summary =
    req.patterns && req.patterns.length > 0
      ? req.patterns.join("\n")
      : `${req.permission} approval requested`;
  return {
    summary,
    details: { permission: req.permission, metadata: req.metadata, patterns: req.patterns },
  };
}

function questionRequestPayload(req: QuestionRequest): {
  summary: string;
  options: { optionId: string; label: string; description?: string }[];
  multiSelect: boolean;
} {
  const questions = req.questions ?? [];
  const summary =
    questions
      .map((q) => q.header ?? q.question ?? "")
      .filter((s) => s.length > 0)
      .join("\n") || "Input requested";
  const options: { optionId: string; label: string; description?: string }[] = [];
  let multiSelect = false;
  for (let qi = 0; qi < questions.length; qi += 1) {
    const q = questions[qi]!;
    if (q.multiple) multiSelect = true;
    const opts = q.options ?? [];
    for (let oi = 0; oi < opts.length; oi += 1) {
      const opt = opts[oi]!;
      const id = `q${qi}.${oi}`;
      options.push({
        optionId: id,
        label: opt.label,
        ...(opt.description ? { description: opt.description } : {}),
      });
    }
  }
  return { summary, options, multiSelect };
}

function permissionRequestId(id: string): string {
  return `opencode-perm-${id}`;
}

function questionRequestId(id: string): string {
  return `opencode-q-${id}`;
}

/**
 * Map a single OpenCode SSE event to canonical RuntimeEvents. Returns an
 * empty array for events that are not surfaced (or are session-status only —
 * those are surfaced through `StructuredSessionListener.onUpdate` separately
 * by the session class).
 */
export function mapOpenCodeEvent(
  event: EventSubscribeResponse,
  state: OpenCodeMapperState,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];

  switch (event.type) {
    case "message.part.delta": {
      const { partID, messageID, field, delta } = event.properties;
      if (state.messageRoles.get(messageID) === "user") return events;
      // Route by part type, not field name. OpenCode emits `field: "text"` for
      // both TextPart and ReasoningPart deltas (the field is the property name
      // on the part — both have a `text` property), so the field alone is
      // ambiguous. The part type comes from the preceding `message.part.updated`
      // snapshot. If a delta sneaks in before that snapshot, fall back to the
      // field name (with `field === "reasoning"` honoured forward-compatibly,
      // even though the current emitter only sends "text").
      const knownType = state.partTypes.get(partID);
      const route =
        knownType ?? (field === "reasoning" ? "reasoning" : field === "text" ? "text" : undefined);
      if (route === "reasoning") {
        const itemId = ensureReasoningItemForPart(state, partID, messageID, events);
        appendDelta(state, partID, itemId, delta, "reasoning_text", events);
      } else if (route === "text") {
        const itemId = ensureAssistantItemForMessage(state, messageID, events);
        appendDelta(state, partID, itemId, delta, "assistant_text", events);
      }
      return events;
    }
    case "message.part.updated": {
      handlePart(state, event.properties.part, events);
      return events;
    }
    case "message.part.removed": {
      const { partID } = event.properties;
      const tool = state.toolItems.get(partID);
      if (tool) {
        events.push({
          type: "item.completed",
          threadId: state.threadId,
          itemId: tool.itemId,
        });
        state.toolItems.delete(partID);
      }
      completeReasoningItem(state, partID, events);
      state.emittedText.delete(partID);
      state.partTypes.delete(partID);
      return events;
    }
    case "message.updated": {
      const info = event.properties.info;
      const usageEvent = createOpenCodeContextUsageEvent(state.threadId, info);
      if (usageEvent) events.push(usageEvent);
      state.messageRoles.set(info.id, info.role);
      if (info.role === "user" && !state.userItems.has(info.id)) {
        const optimistic = state.pendingUserMessageItemIds.shift();
        const itemId = optimistic ?? newItemId("user");
        state.userItems.set(info.id, itemId);
        // When the runtime already painted an optimistic user_message and
        // handed us its id, the chat pane has the complete bubble — re-emitting
        // item.started would either create a phantom item (different id) or
        // be no-op'd by the per-id dedupe. Skip the emit either way.
        if (!optimistic) {
          events.push({
            type: "item.started",
            threadId: state.threadId,
            itemId,
            itemType: "user_message",
          });
        }
      }
      // For assistant messages, item.started was emitted from the first part.
      // If `info.time.completed` is present, close the assistant item and any
      // reasoning items belonging to this message — defense-in-depth in case
      // the reasoning Part snapshot didn't carry `time.end` before the message
      // wrapped up.
      if (info.role === "assistant" && info.time?.completed) {
        const itemId = state.assistantItems.get(info.id);
        if (itemId) {
          events.push({
            type: "item.completed",
            threadId: state.threadId,
            itemId,
          });
          state.assistantItems.delete(info.id);
        }
        for (const [partID, entry] of state.reasoningItems) {
          if (entry.messageID !== info.id) continue;
          events.push({
            type: "item.completed",
            threadId: state.threadId,
            itemId: entry.itemId,
          });
          state.reasoningItems.delete(partID);
          state.emittedText.delete(partID);
        }
      }
      return events;
    }
    case "message.removed": {
      const { messageID } = event.properties;
      const a = state.assistantItems.get(messageID);
      if (a) {
        events.push({ type: "item.completed", threadId: state.threadId, itemId: a });
        state.assistantItems.delete(messageID);
      }
      const u = state.userItems.get(messageID);
      if (u) {
        events.push({ type: "item.completed", threadId: state.threadId, itemId: u });
        state.userItems.delete(messageID);
      }
      return events;
    }
    case "permission.asked": {
      const req = event.properties;
      const requestType = classifyPermissionRequestType(req);
      const { summary, details } = permissionRequestPayload(req);
      events.push({
        type: "request.opened",
        threadId: state.threadId,
        requestId: permissionRequestId(req.id),
        requestType,
        payload: { summary, details },
      });
      return events;
    }
    case "permission.replied": {
      const { requestID, reply } = event.properties;
      events.push({
        type: "request.resolved",
        threadId: state.threadId,
        requestId: permissionRequestId(requestID),
        outcome: reply === "reject" ? "declined" : "accepted",
      });
      return events;
    }
    case "question.asked": {
      const req = event.properties;
      const { summary, options, multiSelect } = questionRequestPayload(req);
      events.push({
        type: "request.opened",
        threadId: state.threadId,
        requestId: questionRequestId(req.id),
        requestType: "tool_user_input",
        payload: { summary, options, multiSelect },
      });
      return events;
    }
    case "question.replied": {
      events.push({
        type: "request.resolved",
        threadId: state.threadId,
        requestId: questionRequestId(event.properties.requestID),
        outcome: "answered",
      });
      return events;
    }
    case "question.rejected": {
      events.push({
        type: "request.resolved",
        threadId: state.threadId,
        requestId: questionRequestId(event.properties.requestID),
        outcome: "declined",
      });
      return events;
    }
    case "session.error": {
      const err = event.properties.error as
        | { name?: string; data?: { message?: string } }
        | undefined;
      const message = err?.data?.message ?? err?.name ?? "OpenCode session error";
      events.push({ type: "error", threadId: state.threadId, message });
      return events;
    }
    default:
      return events;
  }
}

/** Close any open content items at turn boundaries. */
export function closeOpenItems(state: OpenCodeMapperState): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  for (const [, itemId] of state.assistantItems) {
    events.push({ type: "item.completed", threadId: state.threadId, itemId });
  }
  state.assistantItems.clear();
  for (const [, entry] of state.reasoningItems) {
    events.push({ type: "item.completed", threadId: state.threadId, itemId: entry.itemId });
  }
  state.reasoningItems.clear();
  for (const [, value] of state.toolItems) {
    events.push({ type: "item.completed", threadId: state.threadId, itemId: value.itemId });
  }
  state.toolItems.clear();
  for (const [, itemId] of state.userItems) {
    events.push({ type: "item.completed", threadId: state.threadId, itemId });
  }
  state.userItems.clear();
  state.partTypes.clear();
  state.emittedText.clear();
  state.messageRoles.clear();
  state.pendingUserMessageItemIds.length = 0;
  return events;
}
