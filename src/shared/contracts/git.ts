import { z } from "zod";
import { agentKindSchema, projectLocationSchema, sessionRefSchema } from "./common";

export type RemoteHostPlatform = "github" | "gitlab" | "bitbucket" | "unknown";

export interface GitRemoteInfo {
  url: string;
  platform: RemoteHostPlatform;
  owner: string;
  repo: string;
}

export interface GitFileChange {
  path: string;
  oldPath?: string;
  status: string;
  staged: boolean;
  insertions: number;
  deletions: number;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  tracking: string;
  hasRemote: boolean;
  remoteInfo: GitRemoteInfo | null;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  totalInsertions: number;
  totalDeletions: number;
  mergeInProgress?: boolean;
  conflictFiles?: string[];
}

export interface GitDiffResult {
  diff: string;
}

export interface GitDiffBatchResult {
  staged: Record<string, string>;
  unstaged: Record<string, string>;
}

export interface GitFileContentResult {
  oldContent: string;
  newContent: string;
}

export const getGitStatusPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
});
export type GetGitStatusPayload = z.infer<typeof getGitStatusPayloadSchema>;

export const getGitDiffPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  filePath: z.string().optional(),
  staged: z.boolean().default(false),
});
export type GetGitDiffPayload = z.infer<typeof getGitDiffPayloadSchema>;

export const getGitDiffBatchPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  untrackedPaths: z.array(z.string()).default([]),
});
export type GetGitDiffBatchPayload = z.infer<typeof getGitDiffBatchPayloadSchema>;

export const getGitFileContentPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  filePath: z.string().min(1),
  staged: z.boolean(),
});
export type GetGitFileContentPayload = z.infer<typeof getGitFileContentPayloadSchema>;

export const gitStagePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  filePath: z.string().min(1),
});
export type GitStagePayload = z.infer<typeof gitStagePayloadSchema>;

export const gitUnstagePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  filePath: z.string().min(1),
});
export type GitUnstagePayload = z.infer<typeof gitUnstagePayloadSchema>;

export const gitRevertPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  filePath: z.string().min(1),
});
export type GitRevertPayload = z.infer<typeof gitRevertPayloadSchema>;

export const gitStageAllPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
});
export type GitStageAllPayload = z.infer<typeof gitStageAllPayloadSchema>;

export const gitUnstageAllPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
});
export type GitUnstageAllPayload = z.infer<typeof gitUnstageAllPayloadSchema>;

export const gitRevertAllPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
});
export type GitRevertAllPayload = z.infer<typeof gitRevertAllPayloadSchema>;

export const gitCommitPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  message: z.string().min(1),
  addAll: z.boolean().default(false),
});
export type GitCommitPayload = z.infer<typeof gitCommitPayloadSchema>;

export interface GitCommitResult {
  hash: string;
  message: string;
}

export const generateCommitMessagePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  agentKind: agentKindSchema,
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
});
export type GenerateCommitMessagePayload = z.infer<typeof generateCommitMessagePayloadSchema>;

export interface GenerateCommitMessageResult {
  message: string;
}

export const generateTitlePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  agentKind: agentKindSchema,
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
});
export type GenerateTitlePayload = z.infer<typeof generateTitlePayloadSchema>;

export interface GenerateTitleResult {
  title: string;
}

export const generatePrSummaryPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  agentKind: agentKindSchema,
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
});
export type GeneratePrSummaryPayload = z.infer<typeof generatePrSummaryPayloadSchema>;

export interface GeneratePrSummaryResult {
  title: string;
  description: string;
}

export const extractContextPayloadSchema = z.object({
  threadId: z.string().min(1),
  agentKind: agentKindSchema,
  sessionRef: sessionRefSchema,
  projectLocation: projectLocationSchema,
  worktreePath: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
});
export type ExtractContextPayload = z.infer<typeof extractContextPayloadSchema>;

export interface ExtractContextResult {
  summary: string;
  sourceProvider: string;
  sourceSessionId: string;
  worktreePath?: string;
  extractedAt: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  commit: string;
  isRemote: boolean;
  remote?: string;
}

export interface GitBranchListResult {
  current: string;
  branches: GitBranchInfo[];
}

export interface GitWorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  isMain: boolean;
}

export interface GitWorktreeListResult {
  worktrees: GitWorktreeInfo[];
}

export interface GitAddWorktreeResult {
  path: string;
}

export const getGitBranchesPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  includeRemote: z.boolean().default(true),
});
export type GetGitBranchesPayload = z.infer<typeof getGitBranchesPayloadSchema>;

export const gitFetchPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  remote: z.string().default("origin"),
  prune: z.boolean().default(false),
});
export type GitFetchPayload = z.infer<typeof gitFetchPayloadSchema>;

export const gitListWorktreesPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
});
export type GitListWorktreesPayload = z.infer<typeof gitListWorktreesPayloadSchema>;

export const gitAddWorktreePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1).optional(),
  branch: z.string().optional(),
  createBranch: z.boolean().default(false),
  startPoint: z.string().optional(),
});
export type GitAddWorktreePayload = z.infer<typeof gitAddWorktreePayloadSchema>;

export const gitRemoveWorktreePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  path: z.string().min(1),
  force: z.boolean().default(false),
  deleteBranch: z.boolean().default(false),
});
export type GitRemoveWorktreePayload = z.infer<typeof gitRemoveWorktreePayloadSchema>;

export const gitPruneWorktreesPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  activeWorktreePaths: z.array(z.string()),
});
export type GitPruneWorktreesPayload = z.infer<typeof gitPruneWorktreesPayloadSchema>;

export const gitDeleteBranchPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  branch: z.string().min(1),
  force: z.boolean().default(false),
  remote: z.string().optional(),
});
export type GitDeleteBranchPayload = z.infer<typeof gitDeleteBranchPayloadSchema>;

export const gitSwitchBranchPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  branch: z.string().min(1),
  createNew: z.boolean().default(false),
});
export type GitSwitchBranchPayload = z.infer<typeof gitSwitchBranchPayloadSchema>;

export interface GitSwitchBranchResult {
  branch: string;
  created: boolean;
  tracking: string;
  ahead: number;
  behind: number;
}

export const gitPullPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  remote: z.string().optional().default("origin"),
});
export type GitPullPayload = z.input<typeof gitPullPayloadSchema>;

export const gitPushPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  remote: z.string().optional().default("origin"),
  branch: z.string().optional(),
  setUpstream: z.boolean().optional().default(false),
});
export type GitPushPayload = z.input<typeof gitPushPayloadSchema>;

export const gitSyncPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  remote: z.string().optional().default("origin"),
});
export type GitSyncPayload = z.input<typeof gitSyncPayloadSchema>;

export interface GitSyncResult {
  pulled: boolean;
  pushed: boolean;
}

export const gitGetWorktreeSourceBranchPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  branch: z.string().min(1),
});
export type GitGetWorktreeSourceBranchPayload = z.infer<
  typeof gitGetWorktreeSourceBranchPayloadSchema
>;

export interface GitGetWorktreeSourceBranchResult {
  sourceBranch: string | null;
  commitsAhead: number;
  sourceAhead: number;
}

export const gitMergeToSourcePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  worktreeLocation: projectLocationSchema,
  worktreeBranch: z.string().min(1),
  sourceBranch: z.string().min(1),
});
export type GitMergeToSourcePayload = z.infer<typeof gitMergeToSourcePayloadSchema>;

export interface GitMergeToSourceResult {
  merged: boolean;
  fastForward: boolean;
  newSourceCommit: string;
  error?: string;
  conflictFiles?: string[];
}

export const gitPullFromSourcePayloadSchema = z.object({
  worktreeLocation: projectLocationSchema,
  sourceBranch: z.string().min(1),
});
export type GitPullFromSourcePayload = z.infer<typeof gitPullFromSourcePayloadSchema>;

export interface GitPullFromSourceResult {
  merged: boolean;
  fastForward: boolean;
  conflicting?: boolean;
  error?: string;
  conflictFiles?: string[];
}

export const gitAbortMergePayloadSchema = z.object({
  worktreeLocation: projectLocationSchema,
});
export type GitAbortMergePayload = z.infer<typeof gitAbortMergePayloadSchema>;

export const gitRunMergetoolPayloadSchema = z.object({
  worktreeLocation: projectLocationSchema,
});
export type GitRunMergetoolPayload = z.infer<typeof gitRunMergetoolPayloadSchema>;

export interface GitRunMergetoolResult {
  success: boolean;
  merged?: boolean;
  error?: string;
}

export const gitFinishMergePayloadSchema = z.object({
  worktreeLocation: projectLocationSchema,
});
export type GitFinishMergePayload = z.infer<typeof gitFinishMergePayloadSchema>;

export interface GitFinishMergeResult {
  success: boolean;
  error?: string;
}

export const gitWatchProjectPayloadSchema = z.object({
  projectId: z.string().min(1),
  projectLocation: projectLocationSchema,
});
export type GitWatchProjectPayload = z.infer<typeof gitWatchProjectPayloadSchema>;

export const gitWatchWorktreesPayloadSchema = z.object({
  projectId: z.string().min(1),
  worktreePaths: z.array(z.string()),
});
export type GitWatchWorktreesPayload = z.infer<typeof gitWatchWorktreesPayloadSchema>;

export const gitUnwatchProjectPayloadSchema = z.object({
  projectId: z.string().min(1),
});
export type GitUnwatchProjectPayload = z.infer<typeof gitUnwatchProjectPayloadSchema>;
