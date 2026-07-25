import { z } from "zod";
import { DEFAULT_MCP_PROFILE, mcpProfileSchema, type McpProfile } from "./campaign/mcpProfile";
import { projectLocationSchema } from "./common";
import { projectDraftConfigSchema } from "./config";
import { mcpServerListSchema } from "./mcpServer";

export const projectActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  icon: z.string().optional(),
});
export type ProjectAction = z.infer<typeof projectActionSchema>;

export const projectScriptsSchema = z.object({
  setupScript: z.string().optional(),
  cleanupScript: z.string().optional(),
  /** Gitignore-style patterns for ignored files to copy into new worktrees (e.g. `.env.*`). */
  worktreeCopyPatterns: z.array(z.string()).optional(),
  actions: z.array(projectActionSchema).default([]),
});
export type ProjectScripts = z.infer<typeof projectScriptsSchema>;

/**
 * Where git worktrees are created. `global` places them under a global root
 * (built-in default or a user-configured base); `project-relative` nests them
 * inside the project at `<project>/.poracode/worktrees`.
 */
export const worktreeStorageModeSchema = z.enum(["global", "project-relative"]);
export type WorktreeStorageMode = z.infer<typeof worktreeStorageModeSchema>;

/**
 * Per-project worktree-location override (mirrors {@link projectSearchSettingsSchema}).
 * Absent = inherit the global settings.
 */
export const projectWorktreeLocationSchema = z.object({
  /** Overrides the global worktree storage mode for this project. */
  mode: worktreeStorageModeSchema.optional(),
  /**
   * Custom worktree root for this project: a native path on native projects, a
   * Linux path on WSL projects. Only meaningful in `global` mode; ignored for
   * `project-relative`.
   */
  basePath: z.string().optional(),
});
export type ProjectWorktreeLocation = z.infer<typeof projectWorktreeLocationSchema>;

export const projectSearchSettingsSchema = z.object({
  /** When set, overrides the global `searchUseIgnoreFiles` for this project. */
  useIgnoreFiles: z.boolean().optional(),
  /**
   * Per-project glob overrides. A key with `true` adds an exclusion on top
   * of the global list; `false` disables an inherited default for this
   * project only.
   */
  exclude: z.record(z.string(), z.boolean()).optional(),
});
export type ProjectSearchSettings = z.infer<typeof projectSearchSettingsSchema>;

/**
 * The purpose/kind of a project. Determines which UI surfaces are shown.
 * - `code`: standard development project (default, backward-compatible)
 * - `campaign`: campaign operations workspace bound to a Control Centre campaign group
 * - `research`: research/knowledge-gathering project
 * - `general`: general-purpose project
 */
export const projectPurposeSchema = z.enum(["code", "campaign", "research", "general"]);
export type ProjectPurpose = z.infer<typeof projectPurposeSchema>;

/**
 * Extension data for campaign-purpose projects. Links a Poracode project to a
 * Control Centre campaign group and carries campaign-specific defaults.
 * Required when `purpose === "campaign"`.
 */
export const campaignProjectExtensionSchema = z.object({
  /** The Control Centre campaign group this project is bound to. Empty when unlinked. */
  campaignGroupId: z.string(),
  /** Display name of the client. */
  clientName: z.string().min(1),
  /** Display name of the campaign. */
  campaignName: z.string().min(1),
  /** Agency job/reference number. */
  jobNumber: z.string().optional(),
  /** Default agent kind for new threads in this project. */
  defaultAgentKind: z.string().optional(),
  /** Default model for new threads in this project. */
  defaultModel: z.string().optional(),
  /** Control Centre MCP tool profile. Defaults to "monitoring" when unset. */
  mcpProfile: mcpProfileSchema.optional(),
  /** Named resource aliases (e.g. `@media-plans` → a Drive/SharePoint path). */
  resourceAliases: z.record(z.string(), z.string()).optional(),
});
export type CampaignProjectExtension = z.infer<typeof campaignProjectExtensionSchema>;

const projectObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Project purpose. Defaults to "code" at the DB layer for backward compatibility. */
  purpose: projectPurposeSchema.optional(),
  /** Campaign-specific extension data. Required when purpose is "campaign". */
  campaignExtension: campaignProjectExtensionSchema.optional(),
  location: projectLocationSchema,
  lastDraftConfig: projectDraftConfigSchema.optional(),
  scripts: projectScriptsSchema.optional(),
  searchSettings: projectSearchSettingsSchema.optional(),
  worktreeLocation: projectWorktreeLocationSchema.optional(),
  /** Project MCP entries override global entries by name (case-insensitive). */
  mcpServers: mcpServerListSchema.optional(),
  disabled: z.boolean().optional(),
  createdAt: z.string().min(1),
});

type ProjectObject = z.infer<typeof projectObjectSchema>;

function validateCampaignExtension(project: ProjectObject, ctx: z.RefinementCtx): void {
  if (project.purpose === "campaign" && !project.campaignExtension) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'campaignExtension is required when purpose is "campaign"',
      path: ["campaignExtension"],
    });
  }
}

export const projectSchema = projectObjectSchema.superRefine(validateCampaignExtension);

/** Remote-safe project metadata. Derive before refining so Zod can omit MCP secrets safely. */
export const projectWithoutMcpServersSchema = projectObjectSchema
  .omit({ mcpServers: true })
  .superRefine(validateCampaignExtension);
export type Project = z.infer<typeof projectSchema>;

/** Resolve the effective purpose of a project (defaults to "code" when unset). */
export function getProjectPurpose(project: Project): ProjectPurpose {
  return project.purpose ?? "code";
}

/**
 * Resolve a campaign project's effective Control Centre MCP profile,
 * defaulting to `"plan_revision"` when unset. Only meaningful for
 * `purpose === "campaign"` projects, but safe to call on any project.
 */
export function getCampaignMcpProfile(project: Project): McpProfile {
  return project.campaignExtension?.mcpProfile ?? DEFAULT_MCP_PROFILE;
}
