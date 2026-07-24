import { z } from "zod";

/**
 * Exact Control Centre campaign-decision wire contracts.
 *
 * PROVENANCE: mirrors the deployed Control Centre MCP tool + REST surface
 * (`control_centre-mvp-integration/phase3-on-phases56`):
 *   - `record_campaign_decision` (tool) → `POST /campaign-groups/:id/decisions`
 *     input:  { title, description?, decisionType?, scope?, effect, expiresAt?, reason? }
 *     output: a decision Detail (201).
 *   - `get_campaign_decisions` (tool) → `GET /campaign-groups/:id/decisions`
 *     output: an array of decision Summary.
 *
 * These are Layer-1 schemas — byte-for-byte with the producer. UI-friendly
 * renames belong in adapters (`mapCampaignDecisions`), not here.
 *
 * NOTE ON THE VALIDITY WINDOW: the tool has NO `startsAt` input — the server
 * stamps `startsAt = now()` on insert. The window's start is therefore
 * server-assigned; only `expiresAt` is caller-supplied. `effectiveStatus` is
 * likewise resolved by the server (status + expiry), so the client never
 * re-derives active/expired from timestamps.
 */

export const controlCentreDecisionScopeSchema = z.object({
  platform: z.string().optional(),
  channel: z.string().optional(),
  campaignId: z.string().optional(),
  metric: z.string().optional(),
  ruleType: z.string().optional(),
});
export type ControlCentreDecisionScope = z.infer<typeof controlCentreDecisionScopeSchema>;

export const controlCentreDecisionEffectModeSchema = z.enum([
  "suppress",
  "adjust-threshold",
  "annotate",
  "allow",
]);
export type ControlCentreDecisionEffectMode = z.infer<typeof controlCentreDecisionEffectModeSchema>;

export const controlCentreDecisionEffectSchema = z.object({
  mode: controlCentreDecisionEffectModeSchema,
  thresholdValue: z.number().optional(),
  tolerancePercent: z.number().optional(),
});
export type ControlCentreDecisionEffect = z.infer<typeof controlCentreDecisionEffectSchema>;

export const controlCentreDecisionStatusSchema = z.enum(["active", "expired", "revoked"]);
export type ControlCentreDecisionStatus = z.infer<typeof controlCentreDecisionStatusSchema>;

export const controlCentreCampaignDecisionSummarySchema = z.object({
  id: z.string().min(1),
  campaignGroupId: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  decisionType: z.string(),
  status: controlCentreDecisionStatusSchema,
  effectiveStatus: controlCentreDecisionStatusSchema,
  startsAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ControlCentreCampaignDecisionSummary = z.infer<
  typeof controlCentreCampaignDecisionSummarySchema
>;

/** `get_campaign_decisions` returns a bare array of summaries. */
export const controlCentreCampaignDecisionListSchema = z.array(
  controlCentreCampaignDecisionSummarySchema,
);

export const controlCentreCampaignDecisionDetailSchema =
  controlCentreCampaignDecisionSummarySchema.extend({
    scope: controlCentreDecisionScopeSchema,
    effect: controlCentreDecisionEffectSchema,
    reason: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    revokedByUserId: z.string().nullable(),
  });
export type ControlCentreCampaignDecisionDetail = z.infer<
  typeof controlCentreCampaignDecisionDetailSchema
>;

/**
 * The exact `record_campaign_decision` MCP tool input contract. Mirrors the
 * tool's `inputSchema` field-for-field so the client cannot invent a field the
 * server rejects, nor omit `effect`, which the backend requires.
 */
export const recordCampaignDecisionArgsSchema = z.object({
  campaignGroupId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  decisionType: z.string().min(1).optional(),
  scope: controlCentreDecisionScopeSchema.optional(),
  effect: controlCentreDecisionEffectSchema,
  expiresAt: z.string().optional(),
  reason: z.string().min(1).optional(),
});
export type RecordCampaignDecisionArgs = z.infer<typeof recordCampaignDecisionArgsSchema>;
