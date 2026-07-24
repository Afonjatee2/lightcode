import type { ControlCentreCampaignDecisionSummary } from "@/shared/contracts/campaign/controlCentreCampaignDecision";
import type { CampaignDecisionViewModel } from "./campaignViewModels";

/**
 * Maps the Layer-1 `get_campaign_decisions` summaries to UI-friendly view
 * models. Pure and macro-free (imported by node-environment tests).
 *
 * `isActive` is taken straight from the server's `effectiveStatus` — never
 * recomputed from `startsAt`/`expiresAt` on the client. That keeps the
 * "server decides what a decision affects" rule intact and guarantees an
 * expired decision is never presented as active.
 */
export function mapCampaignDecisions(
  rows: readonly ControlCentreCampaignDecisionSummary[],
): CampaignDecisionViewModel[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    decisionType: row.decisionType,
    status: row.status,
    effectiveStatus: row.effectiveStatus,
    isActive: row.effectiveStatus === "active",
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
  }));
}
