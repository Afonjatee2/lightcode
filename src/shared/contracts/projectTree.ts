import { z } from "zod";
import { projectLocationSchema } from "./common";

export interface FileEntry {
  path: string;
  name: string;
  type: "file" | "directory";
}

export interface SearchProjectFilesResult {
  entries: FileEntry[];
  totalIndexed: number;
}

export const searchConfigSchema = z.object({
  useIgnoreFiles: z.boolean(),
  excludePatterns: z.array(z.string()),
});
export type SearchConfigPayload = z.infer<typeof searchConfigSchema>;

export const searchProjectFilesPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  query: z.string().default(""),
  limit: z.number().int().min(1).max(200).default(50),
  /**
   * Effective search config (defaults + global + per-project) computed in
   * the renderer. Optional for backwards compatibility — when omitted the
   * supervisor falls back to legacy `--exclude-standard` behavior with no
   * extra glob filtering.
   */
  searchConfig: searchConfigSchema.optional(),
});
export type SearchProjectFilesPayload = z.infer<typeof searchProjectFilesPayloadSchema>;

export interface ProjectTreeEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  hasChildren?: boolean;
}

export interface ListProjectTreeResult {
  directoryPath: string;
  entries: ProjectTreeEntry[];
}

export const listProjectTreePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  directoryPath: z.string().default(""),
});
export type ListProjectTreePayload = z.infer<typeof listProjectTreePayloadSchema>;

export interface SearchProjectTreeResult {
  entries: ProjectTreeEntry[];
}

export const searchProjectTreePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  query: z.string().default(""),
  limit: z.number().int().min(1).max(200).default(50),
  searchConfig: searchConfigSchema.optional(),
});
export type SearchProjectTreePayload = z.infer<typeof searchProjectTreePayloadSchema>;

export type ProjectFileReadStatus = "ready" | "binary" | "too_large" | "unsupported";

export interface ReadProjectFileResult {
  path: string;
  status: ProjectFileReadStatus;
  modifiedAtMs: number;
  content?: string;
  lineEnding?: "lf" | "crlf";
  hasBom?: boolean;
}

export const readProjectFilePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1),
});
export type ReadProjectFilePayload = z.infer<typeof readProjectFilePayloadSchema>;

export interface WriteProjectFileResult {
  modifiedAtMs: number;
}

export const writeProjectFilePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1),
  content: z.string(),
  baseModifiedAtMs: z.number().nonnegative(),
});
export type WriteProjectFilePayload = z.infer<typeof writeProjectFilePayloadSchema>;

export const createProjectEntryPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1),
  type: z.enum(["file", "directory"]),
});
export type CreateProjectEntryPayload = z.infer<typeof createProjectEntryPayloadSchema>;

export const renameProjectEntryPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1),
  nextName: z.string().min(1),
});
export type RenameProjectEntryPayload = z.infer<typeof renameProjectEntryPayloadSchema>;

export const moveProjectEntryPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1),
  nextParentPath: z.string().default(""),
});
export type MoveProjectEntryPayload = z.infer<typeof moveProjectEntryPayloadSchema>;

export const deleteProjectEntryPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1),
});
export type DeleteProjectEntryPayload = z.infer<typeof deleteProjectEntryPayloadSchema>;

export const revealProjectEntryPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().default(""),
});
export type RevealProjectEntryPayload = z.infer<typeof revealProjectEntryPayloadSchema>;

export const detectSetupScriptPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
});
export type DetectSetupScriptPayload = z.infer<typeof detectSetupScriptPayloadSchema>;

export interface DetectSetupScriptResult {
  setupScript?: string;
}
