import { z } from "zod";
import {
  gitReviewModeSchema,
  newThreadModeSchema,
  providerDraftConfigSchema,
  terminalPositionSchema,
  themeModeSchema,
  threadRemoveActionSchema,
} from "./contracts";

export const sharedSettingsSchema = z.object({
  themeMode: themeModeSchema,
  terminalPosition: terminalPositionSchema,
  commitGenProvider: z.string(),
  commitGenModel: z.string(),
  commitGenEffort: z.string(),
  titleGenProvider: z.string(),
  titleGenModel: z.string(),
  titleGenEffort: z.string(),
  conflictResolverProvider: z.string(),
  conflictResolverModel: z.string(),
  conflictResolverEffort: z.string(),
  wslCommitGenProvider: z.string(),
  wslCommitGenModel: z.string(),
  wslCommitGenEffort: z.string(),
  wslTitleGenProvider: z.string(),
  wslTitleGenModel: z.string(),
  wslTitleGenEffort: z.string(),
  wslConflictResolverProvider: z.string(),
  wslConflictResolverModel: z.string(),
  wslConflictResolverEffort: z.string(),
  /** Per-agent settings keyed by agent kind, then setting key. */
  agentSettings: z.record(z.string(), z.record(z.string(), z.union([z.boolean(), z.string()]))),
  /** Per-agent hidden model IDs keyed by agent kind. */
  hiddenModels: z.record(z.string(), z.array(z.string())),
  /** Agent kinds that the user has disabled (hidden from the agent picker). */
  disabledAgents: z.array(z.string()),
  /** When true, the composer in terminal-native threads starts collapsed. */
  collapseTerminalComposer: z.boolean(),
  /** Idle minutes before a hidden resumable thread is unloaded. 0 disables auto-unload. */
  staleThreadUnloadMinutes: z.number().int().min(0),
  /** Terminal scrollback scroll speed multiplier. */
  scrollSpeed: z.number().int().min(1).max(10),
  /** Prevent OS sleep while any thread is actively working. */
  preventSleepWhileWorking: z.boolean(),
  /** Default action for the thread remove button: archive or delete permanently. */
  threadRemoveAction: threadRemoveActionSchema,
  /** Default new-thread behaviour: full page or side-by-side panel. */
  newThreadMode: newThreadModeSchema,
  /** Automatically show the terminal panel when running commands or creating worktrees. */
  autoShowTerminalPanel: z.boolean(),
  /** Open git review as a right-side panel or a full page overlay. */
  gitReviewMode: gitReviewModeSchema,
  /** Per-provider last-used draft config (model, effort, mode, etc.). App-wide. */
  providerConfigs: z.record(z.string(), providerDraftConfigSchema),
  /** Enable LSP language servers for the file editor (type checking, completions, etc.). */
  editorLspEnabled: z.boolean(),
});
export type SharedSettings = z.infer<typeof sharedSettingsSchema>;

export const defaultSharedSettings: SharedSettings = {
  themeMode: "system",
  terminalPosition: "bottom",
  commitGenProvider: "auto",
  commitGenModel: "",
  commitGenEffort: "",
  titleGenProvider: "auto",
  titleGenModel: "",
  titleGenEffort: "",
  conflictResolverProvider: "auto",
  conflictResolverModel: "",
  conflictResolverEffort: "",
  wslCommitGenProvider: "auto",
  wslCommitGenModel: "",
  wslCommitGenEffort: "",
  wslTitleGenProvider: "auto",
  wslTitleGenModel: "",
  wslTitleGenEffort: "",
  wslConflictResolverProvider: "auto",
  wslConflictResolverModel: "",
  wslConflictResolverEffort: "",
  agentSettings: {},
  hiddenModels: {},
  disabledAgents: [],
  collapseTerminalComposer: false,
  staleThreadUnloadMinutes: 20,
  scrollSpeed: 2,
  preventSleepWhileWorking: true,
  threadRemoveAction: "archive",
  newThreadMode: "page",
  autoShowTerminalPanel: true,
  gitReviewMode: "panel",
  providerConfigs: {},
  editorLspEnabled: false,
};

function parseSettingOrDefault<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function normalizeSharedSettings(value: unknown): SharedSettings {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  const data = parsed.success ? parsed.data : {};

  return {
    themeMode: parseSettingOrDefault(
      sharedSettingsSchema.shape.themeMode,
      data.themeMode,
      defaultSharedSettings.themeMode,
    ),
    terminalPosition: parseSettingOrDefault(
      sharedSettingsSchema.shape.terminalPosition,
      data.terminalPosition,
      defaultSharedSettings.terminalPosition,
    ),
    commitGenProvider: parseSettingOrDefault(
      sharedSettingsSchema.shape.commitGenProvider,
      data.commitGenProvider,
      defaultSharedSettings.commitGenProvider,
    ),
    commitGenModel: parseSettingOrDefault(
      sharedSettingsSchema.shape.commitGenModel,
      data.commitGenModel,
      defaultSharedSettings.commitGenModel,
    ),
    commitGenEffort: parseSettingOrDefault(
      sharedSettingsSchema.shape.commitGenEffort,
      data.commitGenEffort,
      defaultSharedSettings.commitGenEffort,
    ),
    titleGenProvider: parseSettingOrDefault(
      sharedSettingsSchema.shape.titleGenProvider,
      data.titleGenProvider,
      defaultSharedSettings.titleGenProvider,
    ),
    titleGenModel: parseSettingOrDefault(
      sharedSettingsSchema.shape.titleGenModel,
      data.titleGenModel,
      defaultSharedSettings.titleGenModel,
    ),
    titleGenEffort: parseSettingOrDefault(
      sharedSettingsSchema.shape.titleGenEffort,
      data.titleGenEffort,
      defaultSharedSettings.titleGenEffort,
    ),
    conflictResolverProvider: parseSettingOrDefault(
      sharedSettingsSchema.shape.conflictResolverProvider,
      data.conflictResolverProvider,
      defaultSharedSettings.conflictResolverProvider,
    ),
    conflictResolverModel: parseSettingOrDefault(
      sharedSettingsSchema.shape.conflictResolverModel,
      data.conflictResolverModel,
      defaultSharedSettings.conflictResolverModel,
    ),
    conflictResolverEffort: parseSettingOrDefault(
      sharedSettingsSchema.shape.conflictResolverEffort,
      data.conflictResolverEffort,
      defaultSharedSettings.conflictResolverEffort,
    ),
    wslCommitGenProvider: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslCommitGenProvider,
      data.wslCommitGenProvider,
      defaultSharedSettings.wslCommitGenProvider,
    ),
    wslCommitGenModel: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslCommitGenModel,
      data.wslCommitGenModel,
      defaultSharedSettings.wslCommitGenModel,
    ),
    wslCommitGenEffort: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslCommitGenEffort,
      data.wslCommitGenEffort,
      defaultSharedSettings.wslCommitGenEffort,
    ),
    wslTitleGenProvider: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslTitleGenProvider,
      data.wslTitleGenProvider,
      defaultSharedSettings.wslTitleGenProvider,
    ),
    wslTitleGenModel: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslTitleGenModel,
      data.wslTitleGenModel,
      defaultSharedSettings.wslTitleGenModel,
    ),
    wslTitleGenEffort: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslTitleGenEffort,
      data.wslTitleGenEffort,
      defaultSharedSettings.wslTitleGenEffort,
    ),
    wslConflictResolverProvider: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslConflictResolverProvider,
      data.wslConflictResolverProvider,
      defaultSharedSettings.wslConflictResolverProvider,
    ),
    wslConflictResolverModel: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslConflictResolverModel,
      data.wslConflictResolverModel,
      defaultSharedSettings.wslConflictResolverModel,
    ),
    wslConflictResolverEffort: parseSettingOrDefault(
      sharedSettingsSchema.shape.wslConflictResolverEffort,
      data.wslConflictResolverEffort,
      defaultSharedSettings.wslConflictResolverEffort,
    ),
    agentSettings: parseSettingOrDefault(
      sharedSettingsSchema.shape.agentSettings,
      data.agentSettings,
      defaultSharedSettings.agentSettings,
    ),
    hiddenModels: parseSettingOrDefault(
      sharedSettingsSchema.shape.hiddenModels,
      data.hiddenModels,
      defaultSharedSettings.hiddenModels,
    ),
    disabledAgents: parseSettingOrDefault(
      sharedSettingsSchema.shape.disabledAgents,
      data.disabledAgents,
      defaultSharedSettings.disabledAgents,
    ),
    collapseTerminalComposer: parseSettingOrDefault(
      sharedSettingsSchema.shape.collapseTerminalComposer,
      data.collapseTerminalComposer,
      defaultSharedSettings.collapseTerminalComposer,
    ),
    staleThreadUnloadMinutes: parseSettingOrDefault(
      sharedSettingsSchema.shape.staleThreadUnloadMinutes,
      data.staleThreadUnloadMinutes,
      defaultSharedSettings.staleThreadUnloadMinutes,
    ),
    scrollSpeed: parseSettingOrDefault(
      sharedSettingsSchema.shape.scrollSpeed,
      data.scrollSpeed,
      defaultSharedSettings.scrollSpeed,
    ),
    preventSleepWhileWorking: parseSettingOrDefault(
      sharedSettingsSchema.shape.preventSleepWhileWorking,
      data.preventSleepWhileWorking,
      defaultSharedSettings.preventSleepWhileWorking,
    ),
    threadRemoveAction: parseSettingOrDefault(
      sharedSettingsSchema.shape.threadRemoveAction,
      data.threadRemoveAction,
      defaultSharedSettings.threadRemoveAction,
    ),
    newThreadMode: parseSettingOrDefault(
      sharedSettingsSchema.shape.newThreadMode,
      data.newThreadMode,
      defaultSharedSettings.newThreadMode,
    ),
    autoShowTerminalPanel: parseSettingOrDefault(
      sharedSettingsSchema.shape.autoShowTerminalPanel,
      data.autoShowTerminalPanel,
      defaultSharedSettings.autoShowTerminalPanel,
    ),
    gitReviewMode: parseSettingOrDefault(
      sharedSettingsSchema.shape.gitReviewMode,
      data.gitReviewMode,
      defaultSharedSettings.gitReviewMode,
    ),
    providerConfigs: parseSettingOrDefault(
      sharedSettingsSchema.shape.providerConfigs,
      data.providerConfigs,
      defaultSharedSettings.providerConfigs,
    ),
    editorLspEnabled: parseSettingOrDefault(
      sharedSettingsSchema.shape.editorLspEnabled,
      data.editorLspEnabled,
      defaultSharedSettings.editorLspEnabled,
    ),
  };
}
