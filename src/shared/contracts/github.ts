import { z } from "zod";
import { projectLocationSchema } from "./common";

export type PrState = "open" | "draft" | "merged" | "closed";
export type PrMergeMethod = "merge" | "squash" | "rebase";

export interface PrData {
  number: number;
  state: PrState;
  title: string;
  url: string;
  baseBranch: string;
  isDraft: boolean;
  reviewDecision?: string;
  checksStatus?: string;
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus?:
    | "BEHIND"
    | "BLOCKED"
    | "CLEAN"
    | "DIRTY"
    | "DRAFT"
    | "HAS_HOOKS"
    | "UNKNOWN"
    | "UNSTABLE";
  /** True when the authenticated `gh` user authored this PR (can't review own PR). */
  viewerDidAuthor?: boolean;
  updatedAt: string;
}

export interface PrCheck {
  name: string;
  state: string;
  conclusion: string;
}

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

export type PrReviewDecision = "approve" | "request-changes" | "comment";

export interface GhCheckAvailableResult {
  available: boolean;
}

export const ghCreatePrPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default(""),
  isDraft: z.boolean().default(false),
});
export type GhCreatePrPayload = z.infer<typeof ghCreatePrPayloadSchema>;

export const ghGetPrForBranchPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  branch: z.string().min(1),
});
export type GhGetPrForBranchPayload = z.infer<typeof ghGetPrForBranchPayloadSchema>;

export const ghMergePrPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
  method: z.enum(["merge", "squash", "rebase"]).default("merge"),
  admin: z.boolean().default(false),
});
export type GhMergePrPayload = z.infer<typeof ghMergePrPayloadSchema>;

export const ghClosePrPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
});
export type GhClosePrPayload = z.infer<typeof ghClosePrPayloadSchema>;

export const ghReopenPrPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
});
export type GhReopenPrPayload = z.infer<typeof ghReopenPrPayloadSchema>;

export const ghMarkPrReadyPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
});
export type GhMarkPrReadyPayload = z.infer<typeof ghMarkPrReadyPayloadSchema>;

export const ghUpdatePrBranchPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
  rebase: z.boolean().default(false),
});
export type GhUpdatePrBranchPayload = z.infer<typeof ghUpdatePrBranchPayloadSchema>;

export const ghGetPrChecksPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  branch: z.string().min(1),
});
export type GhGetPrChecksPayload = z.infer<typeof ghGetPrChecksPayloadSchema>;

export interface GhGetPrChecksResult {
  checks: PrCheck[];
}

export const ghGetPrFilesPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
});
export type GhGetPrFilesPayload = z.infer<typeof ghGetPrFilesPayloadSchema>;

export interface GhGetPrFilesResult {
  files: PrFile[];
}

export const ghGetPrDiffPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
});
export type GhGetPrDiffPayload = z.infer<typeof ghGetPrDiffPayloadSchema>;

export interface GhGetPrDiffResult {
  diff: string;
}

export const ghSubmitPrReviewPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  prNumber: z.number().int().min(1),
  decision: z.enum(["approve", "request-changes", "comment"]),
  body: z.string().default(""),
});
export type GhSubmitPrReviewPayload = z.infer<typeof ghSubmitPrReviewPayloadSchema>;
