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
  updatedAt: string;
}

export interface PrCheck {
  name: string;
  state: string;
  conclusion: string;
}

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

export const ghGetPrChecksPayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  branch: z.string().min(1),
});
export type GhGetPrChecksPayload = z.infer<typeof ghGetPrChecksPayloadSchema>;

export interface GhGetPrChecksResult {
  checks: PrCheck[];
}
