import { z } from "zod";

/**
 * Typed Campaign Context contract — mirrors the Control Centre Phase 3 domain
 * types at `@control-centre/shared/domain/campaign-context.ts`. This is the
 * single source of truth in Poracode for the shape returned by
 * `GET /campaign-groups/:id/context` (MCP tool `get_campaign_context`).
 *
 * Control Centre is the producer; Poracode is the consumer. This contract
 * replaces the Phase 2 `z.unknown()` placeholders with the actual schema.
 */

export const evidenceFreshnessStatusSchema = z.enum(["fresh", "stale", "unknown"]);
export type EvidenceFreshnessStatus = z.infer<typeof evidenceFreshnessStatusSchema>;

export const evidenceSourceSchema = z.object({
  sourceType: z.string(),
  sourceId: z.string(),
  label: z.string(),
  capturedAt: z.string().nullable(),
  freshnessStatus: evidenceFreshnessStatusSchema,
});
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const evidenceCalculationSchema = z.object({
  expression: z.string(),
  inputs: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  result: z.union([z.number(), z.string(), z.null()]),
});
export type EvidenceCalculation = z.infer<typeof evidenceCalculationSchema>;

export const evidenceClaimSchema = z.object({
  claimKey: z.string(),
  statement: z.string(),
  calculation: evidenceCalculationSchema.nullable(),
  sources: z.array(evidenceSourceSchema),
});
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export const campaignContextPrioritySchema = z.enum(["P1", "P2", "P3", "P4"]);
export type CampaignContextPriority = z.infer<typeof campaignContextPrioritySchema>;

export const sourceHealthStatusSchema = z.enum(["healthy", "stale", "failed"]);
export type SourceHealthStatus = z.infer<typeof sourceHealthStatusSchema>;

export const campaignContextSchema = z.object({
  identity: z.object({
    id: z.string(),
    name: z.string(),
    clientName: z.string().nullable(),
    jobNumber: z.string().nullable(),
    startDate: z.string(),
    endDate: z.string(),
    status: z.string(),
  }),
  budget: z.object({
    totalBudget: z.number().nullable(),
    spentToDate: z.number(),
    remaining: z.number().nullable(),
    percentUsed: z.number().nullable(),
    expectedPercentUsed: z.number().nullable(),
    pacingStatus: z.string().nullable(),
  }),
  kpiTargets: z.array(
    z.object({
      id: z.string(),
      metricKey: z.string(),
      targetType: z.string(),
      targetValue: z.number(),
      actualValue: z.number().nullable(),
      percentAchieved: z.number().nullable(),
      status: z.string().nullable(),
    }),
  ),
  openAlerts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.string(),
      priority: campaignContextPrioritySchema,
      openedAt: z.string(),
    }),
  ),
  channelExecutions: z.array(
    z.object({
      id: z.string(),
      channelLabel: z.string(),
      platform: z.string(),
      plannedBudget: z.number().nullable(),
      actualSpend: z.number(),
      status: z.string().nullable(),
    }),
  ),
  sourceHealth: z.array(
    z.object({
      sourceAccountId: z.string(),
      sourceName: z.string(),
      status: sourceHealthStatusSchema,
      lastSuccessfulSyncAt: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  activeDecisions: z.array(z.unknown()),
  recentEvents: z.array(z.unknown()),
  pendingProposals: z.array(z.unknown()),
  evidence: z.array(evidenceClaimSchema),
  suggestedQuestions: z.array(z.string()),
});

export type CampaignContext = z.infer<typeof campaignContextSchema>;
