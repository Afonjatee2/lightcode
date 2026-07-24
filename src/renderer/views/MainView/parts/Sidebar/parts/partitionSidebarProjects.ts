import type { Project } from "@/shared/contracts";
import { getProjectPurpose } from "@/shared/contracts/project";
import { isHomeProject } from "@/shared/homeScope";

export const CAMPAIGNS_SIDEBAR_SECTION_KEY = "__campaigns_section__";

export type SidebarProjectPartition = {
  codeProjectIds: string[];
  campaignProjectIds: string[];
};

// Cached per projects-array identity: this runs inside zustand selectors via
// useShallow, whose shallow compare sees the two array *references*. Returning
// fresh arrays for an unchanged store snapshot makes every render look dirty
// and loops the shell into "maximum update depth exceeded" on boot.
const partitionCache = new WeakMap<readonly Project[], SidebarProjectPartition>();

/**
 * Splits non-home projects into code/general sidebar rows vs campaign workspace
 * rows. Campaign-purpose projects are excluded from the general project list.
 */
export function partitionSidebarProjects(projects: readonly Project[]): SidebarProjectPartition {
  const cached = partitionCache.get(projects);
  if (cached) return cached;

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

  const partition: SidebarProjectPartition = { codeProjectIds, campaignProjectIds };
  partitionCache.set(projects, partition);
  return partition;
}
