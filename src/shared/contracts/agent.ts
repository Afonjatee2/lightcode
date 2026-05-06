import { z } from "zod";
import {
  agentKindSchema,
  authStateSchema,
  labeledOptionSchema,
  liveInputModeSchema,
  threadModeSchema,
  threadPresentationModeSchema,
} from "./common";

const agentToggleSettingDefSchema = z.object({
  key: z.string().min(1),
  type: z.literal("toggle"),
  env: z.record(z.string(), z.string()),
  label: z.string().min(1),
  description: z.string(),
  default: z.boolean(),
  platforms: z.array(z.string()).optional(),
});

const agentSelectSettingDefSchema = z.object({
  key: z.string().min(1),
  type: z.literal("select"),
  envVar: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  default: z.string(),
  options: z.array(labeledOptionSchema),
  platforms: z.array(z.string()).optional(),
});

/** Slash commands reported by Claude Code SDK initialization (optional metadata). */
export const agentSlashCommandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  argumentHint: z.string().optional(),
});
export type AgentSlashCommand = z.infer<typeof agentSlashCommandSchema>;

export const agentSettingDefSchema = z.discriminatedUnion("type", [
  agentToggleSettingDefSchema,
  agentSelectSettingDefSchema,
]);
export type AgentSettingDef = z.infer<typeof agentSettingDefSchema>;

export const agentCapabilitySchema = z.object({
  models: z.array(labeledOptionSchema).default([]),
  efforts: z.array(z.string().min(1)).default([]),
  defaultEffort: z.string().optional(),
  modelEfforts: z.record(z.string(), z.array(z.string().min(1))).default({}),
  /** Optional sub-provider grouping (e.g. OpenCode Zen, GitHub Copilot under OpenCode). */
  subProviders: z.array(labeledOptionSchema).optional(),
  /** Map from model id to its sub-provider id. Falls back to model-id namespace prefix when omitted. */
  modelSubProvider: z.record(z.string(), z.string()).optional(),
  /** Available context-window sizes (when a model exposes more than one). */
  contextSizes: z.array(labeledOptionSchema).optional(),
  /** Per-model allowed contextSize ids. */
  modelContextSizes: z.record(z.string(), z.array(z.string().min(1))).optional(),
  /** Provider's default contextSize id. */
  defaultContextSize: z.string().optional(),
  /** Model ids that support a fast/turbo execution mode. */
  fastModels: z.array(z.string().min(1)).optional(),
  modes: z.array(threadModeSchema).default([]),
  approvalPolicies: z.array(labeledOptionSchema).default([]),
  sandboxModes: z.array(labeledOptionSchema).default([]),
  supportsResume: z.boolean().default(false),
  supportsDirectInput: z.boolean().default(true),
  liveInputMode: liveInputModeSchema.default("terminal"),
  presentationMode: threadPresentationModeSchema.default("terminal"),
  /**
   * Modes the adapter supports. When >1, the new-thread picker exposes a
   * Mode select (Terminal / Chat). Defaults to `[presentationMode]` (computed
   * by consumers) — adapters that haven't migrated yet keep working unchanged.
   */
  presentationModes: z.array(threadPresentationModeSchema).optional(),
  requiresTerminalFocusBeforeInput: z.boolean().optional(),
  bypassApprovalPolicy: z.string().optional(),
  settingDefs: z.array(agentSettingDefSchema).default([]),
  /** Populated when the Claude Agent SDK init probe succeeds (install detection). */
  slashCommands: z.array(agentSlashCommandSchema).optional(),
});
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;

export const agentStatusSchema = z.object({
  kind: agentKindSchema,
  label: z.string().min(1),
  installed: z.boolean(),
  executablePath: z.string().optional(),
  version: z.string().optional(),
  authState: authStateSchema,
  capabilities: agentCapabilitySchema,
  envKind: z.enum(["windows", "wsl", "posix"]).optional(),
  envDistro: z.string().optional(),
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const getAgentStatusesPayloadSchema = z.object({
  wslDistros: z.array(z.string().min(1)).default([]),
});
export type GetAgentStatusesPayload = z.infer<typeof getAgentStatusesPayloadSchema>;

export const agentStatusesResponseSchema = z.object({
  windows: z.array(agentStatusSchema).default([]),
  wsl: z.array(agentStatusSchema).default([]),
  /**
   * True when the response was populated from the on-disk cache.
   * False when no cache file was available (e.g. first launch) — the caller
   * should show a detecting/loading state until fresh detection events arrive.
   */
  fromCache: z.boolean(),
});
export type AgentStatusesResponse = z.infer<typeof agentStatusesResponseSchema>;
