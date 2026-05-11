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

/** Optional slash-command metadata surfaced by providers and/or active sessions. */
export const agentSlashCommandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  argumentHint: z.string().optional(),
});
export type AgentSlashCommand = z.infer<typeof agentSlashCommandSchema>;

export const agentConnectedProviderSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1).optional(),
});
export type AgentConnectedProvider = z.infer<typeof agentConnectedProviderSchema>;

export const agentProviderMetadataSchema = z.object({
  authenticatedAs: z.string().min(1).optional(),
  organization: z.string().min(1).optional(),
  plan: z.string().min(1).optional(),
  authMethod: z.string().min(1).optional(),
  connectedProviders: z.array(agentConnectedProviderSchema).optional(),
});
export type AgentProviderMetadata = z.infer<typeof agentProviderMetadataSchema>;

export const agentSettingDefSchema = z.discriminatedUnion("type", [
  agentToggleSettingDefSchema,
  agentSelectSettingDefSchema,
]);
export type AgentSettingDef = z.infer<typeof agentSettingDefSchema>;

const agentPresentationCapabilityOverrideSchema = z
  .object({
    models: z.array(labeledOptionSchema),
    efforts: z.array(z.string().min(1)),
    defaultEffort: z.string().optional(),
    modelEfforts: z.record(z.string(), z.array(z.string().min(1))),
    subProviders: z.array(labeledOptionSchema).optional(),
    modelSubProvider: z.record(z.string(), z.string()).optional(),
    contextSizes: z.array(labeledOptionSchema).optional(),
    modelContextSizes: z.record(z.string(), z.array(z.string().min(1))).optional(),
    defaultContextSize: z.string().optional(),
    fastModels: z.array(z.string().min(1)).optional(),
    thinkingModels: z.array(z.string().min(1)).optional(),
    modes: z.array(threadModeSchema),
    approvalPolicies: z.array(labeledOptionSchema),
    sandboxModes: z.array(labeledOptionSchema),
    supportsResume: z.boolean(),
    supportsDirectInput: z.boolean(),
    liveInputMode: liveInputModeSchema,
    presentationMode: threadPresentationModeSchema,
    presentationModes: z.array(threadPresentationModeSchema).optional(),
    requiresTerminalFocusBeforeInput: z.boolean().optional(),
    bypassApprovalPolicy: z.string().optional(),
    settingDefs: z.array(agentSettingDefSchema),
    slashCommands: z.array(agentSlashCommandSchema).optional(),
  })
  .partial();

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
  /** Model ids that support a thinking/reasoning toggle separate from effort level. */
  thinkingModels: z.array(z.string().min(1)).optional(),
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
  /**
   * Optional capability overrides for providers whose terminal and GUI runtimes
   * expose different model surfaces. Consumers merge the active presentation's
   * override over the root capability object.
   */
  presentationCapabilities: z
    .object({
      terminal: agentPresentationCapabilityOverrideSchema.optional(),
      gui: agentPresentationCapabilityOverrideSchema.optional(),
    })
    .optional(),
});
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;

export const agentStatusSchema = z.object({
  kind: agentKindSchema,
  label: z.string().min(1),
  installed: z.boolean(),
  executablePath: z.string().optional(),
  version: z.string().optional(),
  authState: authStateSchema,
  providerMetadata: agentProviderMetadataSchema.optional(),
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

const acpRegistryPackageDistributionSchema = z.object({
  package: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const acpRegistryBinaryTargetSchema = z.object({
  archive: z.string().url(),
  cmd: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const acpRegistryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  repository: z.string().url().optional(),
  website: z.string().url().optional(),
  authors: z.array(z.string()).optional(),
  license: z.string().optional(),
  icon: z.string().optional(),
  distribution: z.object({
    npx: acpRegistryPackageDistributionSchema.optional(),
    uvx: acpRegistryPackageDistributionSchema.optional(),
    binary: z.record(z.string(), acpRegistryBinaryTargetSchema).optional(),
  }),
});
export type AcpRegistryAgent = z.infer<typeof acpRegistryAgentSchema>;

export const acpRegistryListResultSchema = z.object({
  version: z.string().min(1),
  agents: z.array(acpRegistryAgentSchema),
});
export type AcpRegistryListResult = z.infer<typeof acpRegistryListResultSchema>;

export const installedAcpRegistryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  installedAt: z.string().min(1),
  adapterKind: agentKindSchema,
  installKind: z.enum(["first-class", "generic"]),
});
export type InstalledAcpRegistryAgent = z.infer<typeof installedAcpRegistryAgentSchema>;

export const installAcpRegistryAgentPayloadSchema = z.object({
  agentId: z.string().min(1),
});
export type InstallAcpRegistryAgentPayload = z.infer<typeof installAcpRegistryAgentPayloadSchema>;

export const removeAcpRegistryAgentPayloadSchema = z.object({
  agentId: z.string().min(1),
});
export type RemoveAcpRegistryAgentPayload = z.infer<typeof removeAcpRegistryAgentPayloadSchema>;

export const acpRegistryMutationResultSchema = z.object({
  installed: z.array(installedAcpRegistryAgentSchema),
});
export type AcpRegistryMutationResult = z.infer<typeof acpRegistryMutationResultSchema>;

export function areAgentSlashCommandsEqual(
  left: readonly AgentSlashCommand[] | undefined,
  right: readonly AgentSlashCommand[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftCommand = left[index]!;
    const rightCommand = right[index]!;
    if (
      leftCommand.id !== rightCommand.id ||
      leftCommand.label !== rightCommand.label ||
      leftCommand.description !== rightCommand.description ||
      leftCommand.argumentHint !== rightCommand.argumentHint
    ) {
      return false;
    }
  }
  return true;
}

export function areAgentConnectedProvidersEqual(
  left: readonly AgentConnectedProvider[] | undefined,
  right: readonly AgentConnectedProvider[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftProvider = left[index]!;
    const rightProvider = right[index]!;
    if (
      leftProvider.label !== rightProvider.label ||
      leftProvider.detail !== rightProvider.detail
    ) {
      return false;
    }
  }
  return true;
}

export function areAgentProviderMetadataEqual(
  left: AgentProviderMetadata | undefined,
  right: AgentProviderMetadata | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return left === right;
  return (
    left.authenticatedAs === right.authenticatedAs &&
    left.organization === right.organization &&
    left.plan === right.plan &&
    left.authMethod === right.authMethod &&
    areAgentConnectedProvidersEqual(left.connectedProviders, right.connectedProviders)
  );
}

export function compactAgentProviderMetadata(
  metadata: AgentProviderMetadata | undefined,
): AgentProviderMetadata | undefined {
  if (!metadata) return undefined;
  const connectedProviders = metadata.connectedProviders?.filter(
    (provider) => provider.label.trim().length > 0,
  );
  const compacted: AgentProviderMetadata = {
    ...(metadata.authenticatedAs?.trim()
      ? { authenticatedAs: metadata.authenticatedAs.trim() }
      : {}),
    ...(metadata.organization?.trim() ? { organization: metadata.organization.trim() } : {}),
    ...(metadata.plan?.trim() ? { plan: metadata.plan.trim() } : {}),
    ...(metadata.authMethod?.trim() ? { authMethod: metadata.authMethod.trim() } : {}),
    ...(connectedProviders?.length ? { connectedProviders } : {}),
  };
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}
