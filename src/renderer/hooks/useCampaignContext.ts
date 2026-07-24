import { controlCentreCampaignContextSchema } from "@/shared/contracts/campaign/controlCentreCampaignContext";
import type { CampaignContextViewModel } from "@/renderer/adapters/campaignViewModels";
import { mapCampaignContext } from "@/renderer/adapters/mapCampaignContext";
import {
  useControlCentreTool,
  type ControlCentreToolState,
} from "./useControlCentreTool";

export type CampaignContextState = ControlCentreToolState<CampaignContextViewModel>;

/**
 * Fetches one campaign group's full context from Control Centre via the
 * `get_campaign_context` MCP tool. Parses the EXACT CC wire schema, maps
 * through the Layer-2 adapter, and returns the UI-friendly view model.
 * Returns loading / empty (no campaign linked yet) / unauthorized /
 * unavailable / error / ready as distinct states — never a bare spinner.
 */
export function useCampaignContext(
  projectId: string | undefined,
  campaignGroupId: string | null | undefined,
): CampaignContextState & { refetch: () => void } {
  const { state, refetch } = useControlCentreTool({
    projectId,
    toolName: "get_campaign_context",
    args: { id: campaignGroupId ?? "" },
    schema: controlCentreCampaignContextSchema,
    skip: !campaignGroupId,
  });

  if (state.status === "ready") {
    return { status: "ready", data: mapCampaignContext(state.data), refetch };
  }
  return { ...state, refetch } as CampaignContextState & { refetch: () => void };
}
