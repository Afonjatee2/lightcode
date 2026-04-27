import { z } from "zod";
import {
  agentKindSchema,
  projectLocationSchema,
  sessionRefSchema,
  threadAttentionSchema,
  threadStatusSchema,
} from "./common";
import { threadConfigSchema } from "./config";

/** How thread status/attention is derived for terminal agents (supervisor → renderer). */
export const threadStatusSourceSchema = z.enum(["cli_hook", "terminal_parse", "server"]);
export type ThreadStatusSource = z.infer<typeof threadStatusSourceSchema>;

export const threadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  agentKind: agentKindSchema,
  config: threadConfigSchema,
  status: threadStatusSchema,
  attention: threadAttentionSchema,
  canResumeWithConfig: z.boolean().default(false),
  sessionRef: sessionRefSchema.optional(),
  worktreePath: z.string().optional(),
  worktreeBranch: z.string().optional(),
  prNumber: z.number().optional(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  archived: z.boolean().default(false),
  done: z.boolean().default(false),
  starred: z.boolean().default(false),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** Set by supervisor `thread-state`; not user-editable. */
  threadStatusSource: threadStatusSourceSchema.optional(),
});
export type Thread = z.infer<typeof threadSchema>;

export interface ThreadRuntimeSnapshot {
  threadId: string;
  status: z.infer<typeof threadStatusSchema>;
  attention: z.infer<typeof threadAttentionSchema>;
  config?: z.infer<typeof threadConfigSchema>;
  sessionRef?: z.infer<typeof sessionRefSchema>;
  canResumeWithConfig: boolean;
  errorMessage?: string;
  threadStatusSource?: ThreadStatusSource;
}

export const terminalSizeSchema = z.object({
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
});
export type TerminalSize = z.infer<typeof terminalSizeSchema>;

export const promptSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), content: z.string() }),
  z.object({ kind: z.literal("file"), path: z.string() }),
  z.object({ kind: z.literal("attachment"), path: z.string(), mimeType: z.string().optional() }),
]);
export type PromptSegment = z.infer<typeof promptSegmentSchema>;

export const startThreadPayloadSchema = z.object({
  threadId: z.string().min(1).optional(),
  projectLocation: projectLocationSchema,
  agentKind: agentKindSchema,
  config: threadConfigSchema,
  prompt: z.string().default(""),
  segments: z.array(promptSegmentSchema).optional(),
  initialSize: terminalSizeSchema,
  sessionRef: sessionRefSchema.optional(),
});
export type StartThreadPayload = z.infer<typeof startThreadPayloadSchema>;

export interface StartThreadResult {
  threadId: string;
}

export const sendThreadInputPayloadSchema = z.object({
  threadId: z.string().min(1),
  prompt: z.string().min(1),
  segments: z.array(promptSegmentSchema).optional(),
  config: threadConfigSchema,
});
export type SendThreadInputPayload = z.infer<typeof sendThreadInputPayloadSchema>;

export const writeTerminalPayloadSchema = z.object({
  threadId: z.string().min(1),
  data: z.string().min(1),
});
export type WriteTerminalPayload = z.infer<typeof writeTerminalPayloadSchema>;

export const resizeTerminalPayloadSchema = terminalSizeSchema.extend({
  threadId: z.string().min(1),
});
export type ResizeTerminalPayload = z.infer<typeof resizeTerminalPayloadSchema>;

export const closeThreadPayloadSchema = z.object({
  threadId: z.string().min(1),
});
export type CloseThreadPayload = z.infer<typeof closeThreadPayloadSchema>;

export const threadServerRequestIdSchema = z.union([z.string().min(1), z.number()]);
export type ThreadServerRequestId = z.infer<typeof threadServerRequestIdSchema>;

export const resolveThreadServerRequestPayloadSchema = z.object({
  threadId: z.string().min(1),
  requestId: threadServerRequestIdSchema,
  method: z.string().min(1),
  response: z.unknown(),
});
export type ResolveThreadServerRequestPayload = z.infer<
  typeof resolveThreadServerRequestPayloadSchema
>;

export const startShellPayloadSchema = z.object({
  shellId: z.string().min(1),
  projectLocation: projectLocationSchema,
  worktreePath: z.string().min(1).optional(),
});
export type StartShellPayload = z.infer<typeof startShellPayloadSchema>;
