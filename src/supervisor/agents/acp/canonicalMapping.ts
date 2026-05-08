/**
 * Generic ACP → canonical RuntimeEvent mapper.
 *
 * This is the SINGLE source of truth for translating ACP protocol messages
 * (`@agentclientprotocol/sdk`) into Lightcode's canonical chat events. It is
 * consumed by every ACP-speaking adapter — Copilot, future Gemini-ACP,
 * user-registered generic-ACP instances, and the `codex-acp` Rust shim.
 *
 * **Zero provider-specific branches.** The mapper imports types from the ACP
 * SDK only; provider identity is irrelevant to the translation.
 */

import { randomUUID } from "node:crypto";
import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  CanonicalContentBlock,
  CanonicalItemType,
  CanonicalRequestType,
  RuntimeEvent,
} from "@/shared/contracts";

/** Per-session state — tracks open items so deltas land on the right item id. */
export interface AcpMapperState {
  threadId: string;
  /** Item id of the currently-streaming assistant message, if any. */
  openAssistantItemId?: string;
  /** Item id of the currently-streaming reasoning item, if any. */
  openReasoningItemId?: string;
  /** Item id of the currently-streaming user message, if any. */
  openUserItemId?: string;
  /** Map ACP `toolCallId` → our internal item id. */
  toolCallItems: Map<string, string>;
  /** Item id of the most recent plan, if open. */
  openPlanItemId?: string;
  /** ACP `toolCallId`s rerouted to other item types (e.g. assistant_message
   * for Copilot's `task_complete` summary). Their `tool_call_update`s must be
   * dropped so we don't emit ghost updates against the wrong item. */
  suppressedToolCallIds: Set<string>;
}

export function createAcpMapperState(threadId: string): AcpMapperState {
  return {
    threadId,
    toolCallItems: new Map(),
    suppressedToolCallIds: new Set(),
  };
}

function newItemId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const OPEN_CONTENT_ITEM_KEYS = [
  "openAssistantItemId",
  "openReasoningItemId",
  "openUserItemId",
] as const;

/** Close any open assistant/user/reasoning items as a turn boundary. */
export function closeOpenContentItems(state: AcpMapperState): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  for (const key of OPEN_CONTENT_ITEM_KEYS) {
    const itemId = state[key];
    if (itemId) {
      events.push({ type: "item.completed", threadId: state.threadId, itemId });
      delete state[key];
    }
  }
  return events;
}

/**
 * Drop per-turn bookkeeping that wouldn't otherwise be released — orphaned
 * tool-call ids (the agent never sent a terminal status), plan id (plan was
 * abandoned mid-turn). Call from the session at end-of-turn after
 * `closeOpenContentItems`.
 */
export function resetMapperForTurnEnd(state: AcpMapperState): void {
  state.toolCallItems.clear();
  state.suppressedToolCallIds.clear();
  delete state.openPlanItemId;
}

function acpContentBlockToCanonical(block: ContentBlock): CanonicalContentBlock | undefined {
  if (block.type === "text") {
    return { kind: "text", text: block.text };
  }
  if (block.type === "image") {
    return {
      kind: "image",
      mimeType: block.mimeType ?? "application/octet-stream",
      dataUrl: `data:${block.mimeType ?? "application/octet-stream"};base64,${block.data}`,
    };
  }
  if (block.type === "resource_link") {
    return { kind: "file", path: block.uri.replace(/^file:\/\//, ""), name: block.name };
  }
  return undefined;
}

/**
 * Map a single ACP `SessionNotification` to zero-or-more canonical events.
 * Mutates `state` to track open items.
 */
export function mapAcpSessionUpdate(
  notification: SessionNotification,
  state: AcpMapperState,
): RuntimeEvent[] {
  const update: SessionUpdate = notification.update;
  const events: RuntimeEvent[] = [];
  const { threadId } = state;

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      // Open an assistant item on first chunk; emit deltas thereafter.
      if (!state.openAssistantItemId) {
        // Close any prior reasoning/user items — assistant is starting fresh.
        events.push(...closeOpenContentItems(state));
        state.openAssistantItemId = newItemId("asst");
        events.push({
          type: "item.started",
          threadId,
          itemId: state.openAssistantItemId,
          itemType: "assistant_message",
        });
      }
      const content = (update as { content?: ContentBlock }).content;
      if (content) {
        if (content.type === "text") {
          events.push({
            type: "content.delta",
            threadId,
            itemId: state.openAssistantItemId,
            stream: "assistant_text",
            delta: content.text,
          });
        } else {
          const block = acpContentBlockToCanonical(content);
          if (block) {
            events.push({
              type: "item.updated",
              threadId,
              itemId: state.openAssistantItemId,
              payload: { content: [block] },
            });
          }
        }
      }
      break;
    }

    case "agent_thought_chunk": {
      if (!state.openReasoningItemId) {
        // Close any prior assistant — reasoning bracket starts.
        if (state.openAssistantItemId) {
          events.push({
            type: "item.completed",
            threadId,
            itemId: state.openAssistantItemId,
          });
          delete state.openAssistantItemId;
        }
        state.openReasoningItemId = newItemId("reason");
        events.push({
          type: "item.started",
          threadId,
          itemId: state.openReasoningItemId,
          itemType: "reasoning",
        });
      }
      const content = (update as { content?: ContentBlock }).content;
      if (content && content.type === "text") {
        events.push({
          type: "content.delta",
          threadId,
          itemId: state.openReasoningItemId,
          stream: "reasoning_text",
          delta: content.text,
        });
      }
      break;
    }

    case "user_message_chunk": {
      // Intentional skip. The supervisor (or the renderer's optimistic push)
      // already emits a `user_message` item with a stable id at the start of
      // every turn we initiate via `startTurn`. Some ACP servers — Copilot
      // notably — echo the user's prompt back as `user_message_chunk`
      // updates, which the mapper would otherwise turn into a second
      // user_message item with a fresh id (no dedupe target). Dropping the
      // echo keeps the chat free of duplicates without losing data, since
      // the content is identical to what we already painted.
      break;
    }

    case "tool_call": {
      // First seal any open assistant/reasoning so the tool-call surfaces in order.
      events.push(...closeOpenContentItems(state));
      const toolCall = update as {
        toolCallId: string;
        title?: string;
        kind?: string;
        status?: "pending" | "in_progress" | "completed" | "failed";
        rawInput?: unknown;
      };
      // Gemini's `update_topic` is a meta-tool that re-titles the current
      // conversation topic — emitted on nearly every user turn as the model's
      // first action. It's noise in the chat stream (a "thinking" tool that
      // produces no user-facing artifact), so drop it entirely along with its
      // matching `tool_call_update`.
      if (isUpdateTopicTool(toolCall.title, toolCall.kind)) {
        state.suppressedToolCallIds.add(toolCall.toolCallId);
        break;
      }
      // Copilot's `task_complete` is the end-of-turn summary, not a real tool —
      // surface it as an assistant_message so it renders inline with the rest
      // of the response instead of as a collapsed accordion.
      if (isTaskCompleteSummary(toolCall.title, toolCall.kind)) {
        const text = extractTaskCompleteSummary(toolCall.rawInput);
        state.suppressedToolCallIds.add(toolCall.toolCallId);
        if (text) {
          const asstId = newItemId("asst");
          events.push({
            type: "item.started",
            threadId,
            itemId: asstId,
            itemType: "assistant_message",
          });
          events.push({
            type: "content.delta",
            threadId,
            itemId: asstId,
            stream: "assistant_text",
            delta: text,
          });
          events.push({ type: "item.completed", threadId, itemId: asstId });
        }
        break;
      }
      const itemId = newItemId("tool");
      state.toolCallItems.set(toolCall.toolCallId, itemId);
      const status =
        toolCall.status === "completed"
          ? "success"
          : toolCall.status === "failed"
            ? "error"
            : "running";
      const itemType = classifyToolCallItemType(toolCall.kind, toolCall.title);
      events.push({
        type: "item.started",
        threadId,
        itemId,
        itemType,
        payload: buildAcpToolCallPayload(itemType, toolCall, status),
      });
      break;
    }

    case "tool_call_update": {
      const toolCall = update as {
        toolCallId: string;
        title?: string;
        status?: "pending" | "in_progress" | "completed" | "failed";
        rawOutput?: unknown;
      };
      if (state.suppressedToolCallIds.has(toolCall.toolCallId)) {
        if (toolCall.status === "completed" || toolCall.status === "failed") {
          state.suppressedToolCallIds.delete(toolCall.toolCallId);
        }
        break;
      }
      const itemId = state.toolCallItems.get(toolCall.toolCallId);
      if (!itemId) break;
      const isTerminal = toolCall.status === "completed" || toolCall.status === "failed";
      const status =
        toolCall.status === "completed"
          ? "success"
          : toolCall.status === "failed"
            ? "error"
            : "running";
      events.push({
        type: isTerminal ? "item.completed" : "item.updated",
        threadId,
        itemId,
        payload: {
          ...(toolCall.title ? { name: toolCall.title } : {}),
          ...(toolCall.rawOutput !== undefined ? { result: toolCall.rawOutput } : {}),
          status,
        },
      });
      if (isTerminal) {
        state.toolCallItems.delete(toolCall.toolCallId);
      }
      break;
    }

    case "plan": {
      const plan = update as {
        entries?: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>;
      };
      const steps =
        plan.entries?.map((entry) => ({ step: entry.content, status: entry.status })) ?? [];
      if (!state.openPlanItemId) {
        events.push(...closeOpenContentItems(state));
        state.openPlanItemId = newItemId("plan");
        events.push({
          type: "item.started",
          threadId,
          itemId: state.openPlanItemId,
          itemType: "plan",
          payload: { steps },
        });
      } else {
        events.push({
          type: "item.updated",
          threadId,
          itemId: state.openPlanItemId,
          payload: { steps },
        });
      }
      // If every step is completed, close the plan.
      if (steps.length > 0 && steps.every((s) => s.status === "completed")) {
        events.push({
          type: "item.completed",
          threadId,
          itemId: state.openPlanItemId,
          payload: { steps },
        });
        delete state.openPlanItemId;
      }
      break;
    }

    case "current_mode_update": {
      const modeUpdate = update as { currentModeId?: string };
      if (modeUpdate.currentModeId) {
        events.push({
          type: "warning",
          threadId,
          message: `Mode changed to ${modeUpdate.currentModeId}`,
        });
      }
      break;
    }

    default:
      // Other update kinds (`session_info_update`, `config_option_update`, etc.)
      // don't produce chat items in v1. They flow through the existing
      // status/text channels untouched.
      break;
  }

  return events;
}

/**
 * Build the canonical chat-item payload for an ACP `tool_call`.
 *
 * ACP carries a single `(name, rawInput, rawOutput, status)` shape for every
 * kind of tool. After we classify the tool into one of our richer canonical
 * types, the renderer expects type-specific fields (`command`, `path`, `query`)
 * — so we extract those from `rawInput` here. The original `name`/`args` are
 * preserved on the payload so the unified accordion body can still surface the
 * full request for inspection.
 */
function buildAcpToolCallPayload(
  itemType: CanonicalItemType,
  toolCall: { title?: string; kind?: string; rawInput?: unknown },
  status: "running" | "success" | "error",
): Record<string, unknown> {
  const name = toolCall.title ?? toolCall.kind ?? "tool";
  const base: Record<string, unknown> = {
    name,
    args: toolCall.rawInput,
    status,
  };
  if (itemType === "command_execution") {
    const cmd = readStringField(toolCall.rawInput, "command");
    const cwd = readStringField(toolCall.rawInput, "cwd");
    return {
      ...base,
      command: cmd ?? "",
      ...(cwd ? { cwd } : {}),
    };
  }
  if (itemType === "file_change") {
    const path = readStringField(toolCall.rawInput, "path") ?? extractPatchPath(toolCall.rawInput);
    return {
      ...base,
      path: path ?? "",
      changeKind: classifyFileChangeKind(toolCall.kind, toolCall.title, toolCall.rawInput),
    };
  }
  if (itemType === "web_search") {
    const query = readStringField(toolCall.rawInput, "query") ?? name;
    return { ...base, query };
  }
  return base;
}

/**
 * Gemini's `update_topic` tool re-titles the active conversation topic for UI
 * grouping. ACP carries it with `kind: "think"` and `title` set to either the
 * raw tool name (`update_topic`) or the human-readable description Gemini's
 * `getDescription()` returns: `Update topic to: "<title>"` /
 * `Update tactical intent: "<intent>"`. Match on either form so we drop the
 * tool from the chat stream regardless of which Gemini build is in use.
 */
function isUpdateTopicTool(title: string | undefined, kind: string | undefined): boolean {
  const t = (title ?? "").toLowerCase().trim();
  const k = (kind ?? "").toLowerCase().trim();
  if (t === "update_topic" || k === "update_topic") return true;
  return t.startsWith("update topic to:") || t.startsWith("update tactical intent:");
}

/**
 * Copilot's ACP server emits an end-of-turn summary as a `tool_call` named
 * `task_complete`. It isn't a tool — it's the agent's wrap-up message — so we
 * detect it here and reroute it to an assistant_message item instead.
 */
function isTaskCompleteSummary(title: string | undefined, kind: string | undefined): boolean {
  const t = (title ?? "").toLowerCase().trim();
  const k = (kind ?? "").toLowerCase().trim();
  return t === "task_complete" || k === "task_complete";
}

/** Pull the summary text from a `task_complete` `rawInput`. The shape isn't
 * standardized, so we accept the input as either a string or an object with a
 * recognizable text field, falling back to a JSON dump of the object. */
function extractTaskCompleteSummary(input: unknown): string | undefined {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (input && typeof input === "object") {
    for (const key of ["summary", "message", "body", "text", "description"]) {
      const v = (input as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
  }
  return undefined;
}

function readStringField(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** `apply_patch`-style tool calls pass the patch as a single string arg; pull
 * the first `*** (Add|Update|Delete) File: <path>` header so the row can show
 * the affected path even though there is no structured `path` field. */
function extractPatchPath(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const m = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+?)\s*$/m.exec(input);
  return m?.[1]?.trim();
}

function classifyFileChangeKind(
  kind: string | undefined,
  title: string | undefined,
  input: unknown,
): "create" | "edit" | "delete" {
  const k = (kind ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  if (k === "delete" || /\bdelete\b/.test(t)) return "delete";
  if (k === "create" || /\b(create|add)\b/.test(t)) return "create";
  if (typeof input === "string") {
    if (/^\*\*\*\s+Add File:/m.test(input)) return "create";
    if (/^\*\*\*\s+Delete File:/m.test(input)) return "delete";
  }
  return "edit";
}

/**
 * Classify ACP tool kind/title into a canonical item type for richer rendering.
 * - command-style tool calls → command_execution
 * - file-edit / write tool calls → file_change
 * - web search tool calls → web_search
 * - everything else → tool_call
 */
function classifyToolCallItemType(
  kind: string | undefined,
  title: string | undefined,
): CanonicalItemType {
  const k = (kind ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  if (k === "execute" || k === "shell" || /^(run|exec|shell)\b/.test(t)) return "command_execution";
  if (k === "edit" || k === "write" || /\b(edit|write|create|delete|patch)\b/.test(t))
    return "file_change";
  if (k === "search" || /\bsearch\b/.test(t)) return "web_search";
  return "tool_call";
}

/**
 * Map an ACP `requestPermission` call to a canonical `request.opened` event.
 *
 * The `requestId` you pass here is whatever you used to track the resolver
 * (see `AcpStructuredSession.handlePermissionRequest`); the chat UI later
 * resolves it via `bridge.resolveThreadServerRequest()`.
 */
export function mapAcpPermissionRequest(
  req: RequestPermissionRequest,
  state: AcpMapperState,
  requestId: string,
): RuntimeEvent {
  const toolCall = req.toolCall as {
    title?: string;
    kind?: string;
    rawInput?: unknown;
  };
  const requestType = classifyApprovalRequestType(toolCall.kind, toolCall.title);
  const summary = toolCall.title ?? toolCall.kind ?? "Approval requested";
  const options = req.options.map((opt) => ({
    optionId: opt.optionId,
    label: opt.name,
    description: undefined,
  }));
  return {
    type: "request.opened",
    threadId: state.threadId,
    requestId,
    requestType,
    payload: {
      summary,
      details: toolCall.rawInput,
      options,
    },
  };
}

function classifyApprovalRequestType(
  kind: string | undefined,
  title: string | undefined,
): CanonicalRequestType {
  const k = (kind ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  if (k === "execute" || k === "shell" || /^(run|exec|shell)\b/.test(t)) {
    return "command_execution_approval";
  }
  if (k === "edit" || /\b(edit|patch)\b/.test(t)) return "apply_patch_approval";
  if (k === "write" || /\bwrite\b/.test(t)) return "file_change_approval";
  return "tool_user_input";
}
