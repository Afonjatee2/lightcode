import { z } from "zod";

/**
 * Canonical chat-runtime events.
 *
 * The renderer's chat UI consumes only these — never provider-native messages.
 * Each provider's adapter is responsible for translating its native protocol
 * into this vocabulary (`acp/canonicalMapping.ts`, `codex/canonicalMapping.ts`).
 *
 * Modelled on t3code's `ProviderRuntimeEventV2` (packages/contracts/src/providerRuntime.ts):
 * a discriminated `type` union with `itemId`-addressed updates so streaming
 * deltas append to a known item rather than re-emitting the whole message.
 */

export const canonicalItemTypeSchema = z.enum([
  "user_message",
  "assistant_message",
  "reasoning",
  "plan",
  "command_execution",
  "file_change",
  "tool_call",
  "web_search",
  "error",
]);
export type CanonicalItemType = z.infer<typeof canonicalItemTypeSchema>;

export const canonicalRequestTypeSchema = z.enum([
  "command_execution_approval",
  "file_change_approval",
  "apply_patch_approval",
  "tool_user_input",
  "auth_refresh",
]);
export type CanonicalRequestType = z.infer<typeof canonicalRequestTypeSchema>;

export const runtimeContentStreamKindSchema = z.enum([
  "assistant_text",
  "reasoning_text",
  "plan_text",
  "command_output",
  "file_change_output",
]);
export type RuntimeContentStreamKind = z.infer<typeof runtimeContentStreamKindSchema>;

export const canonicalContentBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("image"), mimeType: z.string(), dataUrl: z.string() }),
  z.object({ kind: z.literal("file"), path: z.string(), name: z.string().optional() }),
]);
export type CanonicalContentBlock = z.infer<typeof canonicalContentBlockSchema>;

// ── Per-item payload shapes ──────────────────────────────────────────

export const messageItemPayloadSchema = z.object({
  content: z.array(canonicalContentBlockSchema),
});
export type MessageItemPayload = z.infer<typeof messageItemPayloadSchema>;

export const reasoningItemPayloadSchema = z.object({
  summary: z.string().optional(),
  durationMs: z.number().int().optional(),
});
export type ReasoningItemPayload = z.infer<typeof reasoningItemPayloadSchema>;

export const planStepStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export const planItemPayloadSchema = z.object({
  steps: z.array(
    z.object({
      step: z.string(),
      status: planStepStatusSchema,
    }),
  ),
});
export type PlanItemPayload = z.infer<typeof planItemPayloadSchema>;

export const commandExecutionPayloadSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().optional(),
});
export type CommandExecutionPayload = z.infer<typeof commandExecutionPayloadSchema>;

export const fileChangeKindSchema = z.enum(["create", "edit", "delete"]);
export const fileChangePayloadSchema = z.object({
  path: z.string(),
  changeKind: fileChangeKindSchema,
  diffSummary: z
    .object({
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
    })
    .optional(),
});
export type FileChangePayload = z.infer<typeof fileChangePayloadSchema>;

export const toolCallStatusSchema = z.enum(["running", "success", "error"]);
export const toolCallPayloadSchema = z.object({
  name: z.string(),
  serverId: z.string().optional(),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  status: toolCallStatusSchema,
});
export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>;

export const webSearchPayloadSchema = z.object({
  query: z.string(),
  resultCount: z.number().int().optional(),
});
export type WebSearchPayload = z.infer<typeof webSearchPayloadSchema>;

export const errorItemPayloadSchema = z.object({
  message: z.string(),
});
export type ErrorItemPayload = z.infer<typeof errorItemPayloadSchema>;

// ── Request payloads ─────────────────────────────────────────────────

export const userInputOptionSchema = z.object({
  optionId: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

export const requestPayloadSchema = z.object({
  /** Human-readable summary of what is being asked. */
  summary: z.string(),
  /** Free-form details (path / command / patch text — depends on `requestType`). */
  details: z.unknown().optional(),
  /** When the request is a multi-option pick (tool_user_input). */
  options: z.array(userInputOptionSchema).optional(),
  multiSelect: z.boolean().optional(),
});
export type RequestPayload = z.infer<typeof requestPayloadSchema>;

// ── Discriminated event union ────────────────────────────────────────

export const turnStateSchema = z.enum(["completed", "failed", "interrupted", "cancelled"]);
export type TurnState = z.infer<typeof turnStateSchema>;

export const requestOutcomeSchema = z.enum(["accepted", "declined", "answered", "cancelled"]);
export type RequestOutcome = z.infer<typeof requestOutcomeSchema>;

export const runtimeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.started"),
    threadId: z.string(),
    turnId: z.string().optional(),
  }),
  z.object({
    type: z.literal("session.exited"),
    threadId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn.started"),
    threadId: z.string(),
    turnId: z.string(),
  }),
  z.object({
    type: z.literal("turn.completed"),
    threadId: z.string(),
    turnId: z.string(),
    state: turnStateSchema,
  }),
  z.object({
    type: z.literal("item.started"),
    threadId: z.string(),
    itemId: z.string(),
    itemType: canonicalItemTypeSchema,
    payload: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("item.updated"),
    threadId: z.string(),
    itemId: z.string(),
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal("item.completed"),
    threadId: z.string(),
    itemId: z.string(),
    payload: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("content.delta"),
    threadId: z.string(),
    itemId: z.string(),
    stream: runtimeContentStreamKindSchema,
    delta: z.string(),
  }),
  z.object({
    type: z.literal("request.opened"),
    threadId: z.string(),
    requestId: z.string(),
    requestType: canonicalRequestTypeSchema,
    payload: requestPayloadSchema,
  }),
  z.object({
    type: z.literal("request.resolved"),
    threadId: z.string(),
    requestId: z.string(),
    outcome: requestOutcomeSchema,
  }),
  z.object({
    type: z.literal("warning"),
    threadId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    threadId: z.string(),
    message: z.string(),
  }),
]);
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;
