import type { ControlCentreCampaignGroup } from "@/shared/contracts/campaign/controlCentreCampaignGroupList";
import { DEFAULT_MCP_PROFILE } from "@/shared/contracts/campaign/mcpProfile";

const LIVE_STATUSES = new Set(["live", "active"]);

function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.has(status.trim().toLowerCase());
}

/** Live/active groups first, then alphabetical by campaign name. */
export function sortCampaignGroups(
  groups: readonly ControlCentreCampaignGroup[],
): ControlCentreCampaignGroup[] {
  return [...groups].sort((a, b) => {
    const liveDelta = Number(isLiveStatus(a.status)) - Number(isLiveStatus(b.status));
    if (liveDelta !== 0) return -liveDelta;
    return a.name.localeCompare(b.name);
  });
}

/** Matches campaign name, client name, or job number (case-insensitive). */
export function filterCampaignGroups(
  groups: readonly ControlCentreCampaignGroup[],
  query: string,
): ControlCentreCampaignGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...groups];
  return groups.filter((group) => {
    if (group.name.toLowerCase().includes(normalized)) return true;
    if (group.clientName?.toLowerCase().includes(normalized)) return true;
    if (group.jobNumber?.toLowerCase().includes(normalized)) return true;
    return false;
  });
}

export function campaignGroupToExtension(group: ControlCentreCampaignGroup) {
  return {
    campaignGroupId: group.id,
    clientName: group.clientName?.trim() || group.name,
    campaignName: group.name,
    ...(group.jobNumber?.trim() ? { jobNumber: group.jobNumber.trim() } : {}),
    mcpProfile: DEFAULT_MCP_PROFILE,
  };
}
