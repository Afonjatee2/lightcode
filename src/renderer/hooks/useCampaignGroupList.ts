import { controlCentreCampaignGroupListSchema } from "@/shared/contracts/campaign/controlCentreCampaignGroupList";
import { useControlCentreTool, type ControlCentreToolState } from "./useControlCentreTool";

const NO_ARGS = {};

export type CampaignGroupListState = ControlCentreToolState<
  ReturnType<typeof controlCentreCampaignGroupListSchema.parse>
>;

/**
 * Fetches all campaign groups from Control Centre via `list_campaign_groups`.
 * Uses the global Control Centre MCP server when no project is bound.
 */
export function useCampaignGroupList(options?: {
  skip?: boolean;
  projectId?: string | undefined;
}): CampaignGroupListState & { refetch: () => void } {
  const skip = options?.skip ?? false;
  const projectId = options?.projectId;
  const { state, refetch } = useControlCentreTool({
    projectId,
    toolName: "list_campaign_groups",
    args: NO_ARGS,
    schema: controlCentreCampaignGroupListSchema,
    skip,
    useGlobalServer: !projectId,
  });
  return { ...state, refetch };
}
