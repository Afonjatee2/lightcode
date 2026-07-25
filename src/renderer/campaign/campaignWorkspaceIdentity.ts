import type { CampaignContextIdentityViewModel } from "@/renderer/adapters/campaignViewModels";
import type { Project } from "@/shared/contracts";

/** True when the project is bound to a Control Centre campaign group. */
export function isLinkedCampaignGroupId(campaignGroupId: string | null | undefined): boolean {
  return Boolean(campaignGroupId?.trim());
}

/** Identity for a campaign workspace that has no Control Centre group binding yet. */
export function unlinkedCampaignIdentity(project: Project): CampaignContextIdentityViewModel {
  const extension = project.campaignExtension;
  return {
    campaignGroupId: "",
    campaignName: extension?.campaignName ?? project.name,
    clientName: extension?.clientName ?? null,
    jobNumber: extension?.jobNumber ?? null,
    lifecycleStatus: "unlinked",
  };
}

export function isUnlinkedCampaignProject(project: Project | undefined): boolean {
  return (
    project?.purpose === "campaign" &&
    Boolean(project.campaignExtension) &&
    !isLinkedCampaignGroupId(project.campaignExtension?.campaignGroupId)
  );
}
