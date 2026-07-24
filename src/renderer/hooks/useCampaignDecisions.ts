import { controlCentreCampaignDecisionListSchema } from "@/shared/contracts/campaign/controlCentreCampaignDecision";
import type { CampaignDecisionViewModel } from "@/renderer/adapters/campaignViewModels";
import { mapCampaignDecisions } from "@/renderer/adapters/mapCampaignDecisions";
import { useControlCentreTool, type ControlCentreToolState } from "./useControlCentreTool";

export type CampaignDecisionsState = ControlCentreToolState<CampaignDecisionViewModel[]>;

/**
 * Lists one campaign group's decisions via the read-only `get_campaign_decisions`
 * MCP tool. Passes `includeExpired: true` so the panel can render active
 * decisions with their window AND surface expired ones plainly (never as
 * active) — grouping is driven by the server's `effectiveStatus`, not the
 * client. Reuses the same renderer → supervisor tool-call transport as the
 * campaign context.
 */
export function useCampaignDecisions(
  projectId: string | undefined,
  campaignGroupId: string | null | undefined,
): CampaignDecisionsState & { refetch: () => void } {
  const { state, refetch } = useControlCentreTool({
    projectId,
    toolName: "get_campaign_decisions",
    args: { campaignGroupId: campaignGroupId ?? "", includeExpired: true },
    schema: controlCentreCampaignDecisionListSchema,
    skip: !campaignGroupId,
  });

  if (state.status === "ready") {
    return { status: "ready", data: mapCampaignDecisions(state.data), refetch };
  }
  return { ...state, refetch } as CampaignDecisionsState & { refetch: () => void };
}
