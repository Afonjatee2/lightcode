import { z } from "zod";

/**
 * Wire schema for Control Centre's `get_operations_today` MCP tool response.
 *
 * PROVENANCE: Mirrors the Typebox wire schema in Control Centre Phase 3 exactly:
 *   packages/shared/src/domain/campaign-context.ts
 *   apps/api/src/routes/phase3-schemas.ts (OperationsTodayViewSchema)
 *   apps/api/src/services/operations.ts
 * at base SHA 3df2d0d97c4dace17b68960d4b27470b726f051d.
 *
 * This is the Layer-1 exact contract. The CC payload does NOT include a top-level
 * `counts` object — counts are DERIVED by the Layer-2 adapter from the array lengths.
 */

// --- Shared group entry shape ---------------------------------------------------

/** Source-health summary embedded in every operations-group entry and at the top level. */
export const controlCentreSourceHealthSummarySchema = z.object({
  healthy: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type ControlCentreSourceHealthSummary = z.infer<
  typeof controlCentreSourceHealthSummarySchema
>;

/**
 * Base fields shared by every operations-group entry (needsAttention,
 * waitingForApproval, otherLive).
 */
export const controlCentreOperationsGroupSchema = z.object({
  campaignGroupId: z.string().min(1),
  name: z.string(),
  clientName: z.string().nullable(),
  status: z.string(),
  deliveryState: z.enum(["delivering", "stale", "unavailable", "unknown"]),
  openAlerts: z.number().int().nonnegative(),
  pendingProposals: z.number().int().nonnegative(),
  sourceHealthSummary: controlCentreSourceHealthSummarySchema,
  lastDataFreshnessAt: z.string().nullable(),
});
export type ControlCentreOperationsGroup = z.infer<
  typeof controlCentreOperationsGroupSchema
>;

// --- Bucket entry shapes (extend the base) --------------------------------------

export const controlCentreNeedsAttentionEntrySchema =
  controlCentreOperationsGroupSchema.extend({
    /** Only `needsAttention` entries carry a top priority. */
    topPriority: z.enum(["P1", "P2", "P3", "P4"]),
    attentionReason: z.string(),
  });
export type ControlCentreNeedsAttentionEntry = z.infer<
  typeof controlCentreNeedsAttentionEntrySchema
>;

export const controlCentreWaitingForApprovalEntrySchema =
  controlCentreOperationsGroupSchema.extend({
    attentionReason: z.string(),
  });
export type ControlCentreWaitingForApprovalEntry = z.infer<
  typeof controlCentreWaitingForApprovalEntrySchema
>;

export const controlCentreRecentlyResolvedSchema = z.object({
  campaignGroupId: z.string().min(1),
  name: z.string(),
  alertId: z.string().min(1),
  resolvedAt: z.string(),
});
export type ControlCentreRecentlyResolved = z.infer<
  typeof controlCentreRecentlyResolvedSchema
>;

// --- Top-level schema -----------------------------------------------------------

/**
 * Exact wire schema for the `get_operations_today` MCP tool response body.
 * CC sends `generatedAt` and a top-level `sourceHealthSummary`, but NO top-level
 * `counts` — counts are derived by the Layer-2 adapter.
 */
export const controlCentreOperationsTodaySchema = z.object({
  generatedAt: z.string(),
  needsAttention: z.array(controlCentreNeedsAttentionEntrySchema),
  waitingForApproval: z.array(controlCentreWaitingForApprovalEntrySchema),
  otherLive: z.array(controlCentreOperationsGroupSchema),
  healthyCampaignCount: z.number().int().nonnegative(),
  sourceHealthSummary: controlCentreSourceHealthSummarySchema,
  recentlyResolved: z.array(controlCentreRecentlyResolvedSchema),
});
export type ControlCentreOperationsToday = z.infer<
  typeof controlCentreOperationsTodaySchema
>;
