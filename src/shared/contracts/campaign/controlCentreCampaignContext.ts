import { z } from "zod";

/**
 * Exact Control Centre `get_campaign_context` wire contract.
 *
 * PROVENANCE: copied from the Phase 3 Poracode integration at
 * `/Users/macbookprom116gb/Downloads/lightcode-campaign-context-integration`
 * (base 9be839c3), which mirrors Control Centre Phase 3 base
 * 3df2d0d97c4dace17b68960d4b27470b726f051d.
 *
 * Keep this Layer-1 schema byte-for-byte compatible with the Phase 3 contract
 * until the branches merge, then replace this compatibility copy with the
 * shared Phase 3 module. UI-friendly renames belong in adapters, not here.
 */
export const controlCentreCampaignIdentitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  clientName: z.string().nullable(),
  jobNumber: z.string().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  status: z.string().min(1),
});

export const controlCentreBudgetSchema = z.object({
  totalBudget: z.number().nullable(),
  spentToDate: z.number(),
  remaining: z.number().nullable(),
  percentUsed: z.number().nullable(),
  expectedPercentUsed: z.number().nullable(),
  pacingStatus: z.string().nullable(),
});

export const controlCentreKpiTargetSchema = z.object({
  id: z.string().min(1),
  metricKey: z.string(),
  targetType: z.string(),
  targetValue: z.number(),
  actualValue: z.number().nullable(),
  percentAchieved: z.number().nullable(),
  status: z.string().nullable(),
});

export const controlCentreOpenAlertSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  severity: z.string(),
  priority: z.enum(["P1", "P2", "P3", "P4"]),
  openedAt: z.string(),
});

export const controlCentreChannelExecutionSchema = z.object({
  id: z.string().min(1),
  channelLabel: z.string(),
  platform: z.string(),
  plannedBudget: z.number().nullable(),
  actualSpend: z.number(),
  status: z.string().nullable(),
});

export const controlCentreSourceHealthSchema = z.object({
  sourceAccountId: z.string(),
  sourceName: z.string(),
  status: z.enum(["healthy", "stale", "failed"]),
  lastSuccessfulSyncAt: z.string().nullable(),
  reason: z.string().nullable(),
});

export const controlCentreActiveDecisionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  decisionType: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

export const controlCentreRecentEventSchema = z.object({
  id: z.string().min(1),
  eventType: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  severity: z.string(),
  createdAt: z.string(),
});

export const controlCentrePendingProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.string(),
  riskLevel: z.string().nullable(),
  createdAt: z.string(),
});

export const controlCentreEvidenceSourceSchema = z.object({
  sourceType: z.string(),
  sourceId: z.string(),
  label: z.string(),
  capturedAt: z.string().nullable(),
  freshnessStatus: z.enum(["fresh", "stale", "unknown"]),
});

export const controlCentreEvidenceCalculationSchema = z.object({
  expression: z.string(),
  inputs: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  result: z.union([z.number(), z.string(), z.null()]),
});

export const controlCentreEvidenceClaimSchema = z.object({
  claimKey: z.string(),
  statement: z.string(),
  calculation: controlCentreEvidenceCalculationSchema.nullable(),
  sources: z.array(controlCentreEvidenceSourceSchema),
});

export const controlCentreCampaignContextSchema = z.object({
  identity: controlCentreCampaignIdentitySchema,
  budget: controlCentreBudgetSchema,
  kpiTargets: z.array(controlCentreKpiTargetSchema),
  openAlerts: z.array(controlCentreOpenAlertSchema),
  channelExecutions: z.array(controlCentreChannelExecutionSchema),
  sourceHealth: z.array(controlCentreSourceHealthSchema),
  activeDecisions: z.array(controlCentreActiveDecisionSchema),
  recentEvents: z.array(controlCentreRecentEventSchema),
  pendingProposals: z.array(controlCentrePendingProposalSchema),
  evidence: z.array(controlCentreEvidenceClaimSchema),
  suggestedQuestions: z.array(z.string()),
});

export type ControlCentreCampaignContext = z.infer<typeof controlCentreCampaignContextSchema>;
