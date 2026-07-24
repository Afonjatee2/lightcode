import { useProject } from "@/renderer/state/useThread";
import { getProjectPurpose } from "@/shared/contracts/project";

/** Returns true when the given project is a campaign workspace. */
export function useIsCampaignProject(projectId: string | undefined): boolean {
  const project = useProject(projectId);
  if (!project) return false;
  return getProjectPurpose(project) === "campaign";
}
