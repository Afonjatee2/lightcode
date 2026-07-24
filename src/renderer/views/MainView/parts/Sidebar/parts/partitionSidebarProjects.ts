import type { Project } from "@/shared/contracts";
import { getProjectPurpose } from "@/shared/contracts/project";
import { isHomeProject } from "@/shared/homeScope";

export const CAMPAIGNS_SIDEBAR_SECTION_KEY = "__campaigns_section__";

/**
 * Splits non-home projects into code/general sidebar rows vs campaign workspace
 * rows. Campaign-purpose projects are excluded from the general project list.
 */
export function partitionSidebarProjects(projects: readonly Project[]): {
  codeProjectIds: string[];
  campaignProjectIds: string[];
} {
  const codeProjectIds: string[] = [];
  const campaignProjectIds: string[] = [];

  for (const project of projects) {
    if (isHomeProject(project)) continue;
    if (getProjectPurpose(project) === "campaign") {
      campaignProjectIds.push(project.id);
    } else {
      codeProjectIds.push(project.id);
    }
  }

  return { codeProjectIds, campaignProjectIds };
}
