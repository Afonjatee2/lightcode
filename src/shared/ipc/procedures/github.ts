import {
  getGitStatusPayloadSchema,
  ghClosePrPayloadSchema,
  ghCreatePrPayloadSchema,
  ghGetPrChecksPayloadSchema,
  ghGetPrDiffPayloadSchema,
  ghGetPrFilesPayloadSchema,
  ghGetPrForBranchPayloadSchema,
  ghMarkPrReadyPayloadSchema,
  ghMergePrPayloadSchema,
  ghReopenPrPayloadSchema,
  ghSubmitPrReviewPayloadSchema,
  ghUpdatePrBranchPayloadSchema,
} from "../../contracts";
import type {
  GetGitStatusPayload,
  GhCheckAvailableResult,
  GhClosePrPayload,
  GhCreatePrPayload,
  GhGetPrChecksPayload,
  GhGetPrChecksResult,
  GhGetPrDiffPayload,
  GhGetPrDiffResult,
  GhGetPrFilesPayload,
  GhGetPrFilesResult,
  GhGetPrForBranchPayload,
  GhMarkPrReadyPayload,
  GhMergePrPayload,
  GhReopenPrPayload,
  GhSubmitPrReviewPayload,
  GhUpdatePrBranchPayload,
  PrData,
} from "../../contracts";
import { definePayloadProcedure } from "../core";

export const githubProcedures = {
  ghCheckAvailable: definePayloadProcedure<
    GetGitStatusPayload,
    GhCheckAvailableResult,
    "supervisor"
  >("ghCheckAvailable", "supervisor", getGitStatusPayloadSchema),
  ghCreatePr: definePayloadProcedure<GhCreatePrPayload, PrData, "supervisor">(
    "ghCreatePr",
    "supervisor",
    ghCreatePrPayloadSchema,
  ),
  ghGetPrForBranch: definePayloadProcedure<GhGetPrForBranchPayload, PrData | null, "supervisor">(
    "ghGetPrForBranch",
    "supervisor",
    ghGetPrForBranchPayloadSchema,
  ),
  ghMergePr: definePayloadProcedure<GhMergePrPayload, void, "supervisor">(
    "ghMergePr",
    "supervisor",
    ghMergePrPayloadSchema,
  ),
  ghClosePr: definePayloadProcedure<GhClosePrPayload, void, "supervisor">(
    "ghClosePr",
    "supervisor",
    ghClosePrPayloadSchema,
  ),
  ghReopenPr: definePayloadProcedure<GhReopenPrPayload, void, "supervisor">(
    "ghReopenPr",
    "supervisor",
    ghReopenPrPayloadSchema,
  ),
  ghMarkPrReady: definePayloadProcedure<GhMarkPrReadyPayload, void, "supervisor">(
    "ghMarkPrReady",
    "supervisor",
    ghMarkPrReadyPayloadSchema,
  ),
  ghGetPrChecks: definePayloadProcedure<GhGetPrChecksPayload, GhGetPrChecksResult, "supervisor">(
    "ghGetPrChecks",
    "supervisor",
    ghGetPrChecksPayloadSchema,
  ),
  ghGetPrFiles: definePayloadProcedure<GhGetPrFilesPayload, GhGetPrFilesResult, "supervisor">(
    "ghGetPrFiles",
    "supervisor",
    ghGetPrFilesPayloadSchema,
  ),
  ghGetPrDiff: definePayloadProcedure<GhGetPrDiffPayload, GhGetPrDiffResult, "supervisor">(
    "ghGetPrDiff",
    "supervisor",
    ghGetPrDiffPayloadSchema,
  ),
  ghSubmitPrReview: definePayloadProcedure<GhSubmitPrReviewPayload, void, "supervisor">(
    "ghSubmitPrReview",
    "supervisor",
    ghSubmitPrReviewPayloadSchema,
  ),
  ghUpdatePrBranch: definePayloadProcedure<GhUpdatePrBranchPayload, void, "supervisor">(
    "ghUpdatePrBranch",
    "supervisor",
    ghUpdatePrBranchPayloadSchema,
  ),
} as const;
