import { join } from "node:path";
import type { Project, ProjectLocation } from "@/shared/contracts";
import {
  PERFORMANCE_SNAPSHOT_DIR,
  PERFORMANCE_SNAPSHOT_FILENAME,
} from "@/shared/contracts/campaign/performanceSnapshot";

/** Resolves the native workspace root for snapshot file watching. */
export function resolveCampaignWorkspaceRoot(location: ProjectLocation): string | null {
  if (location.kind === "wsl") {
    return null;
  }
  return location.path;
}

export function resolvePerformanceSnapshotPath(workspaceRoot: string): string {
  return join(workspaceRoot, PERFORMANCE_SNAPSHOT_DIR, PERFORMANCE_SNAPSHOT_FILENAME);
}

export function resolvePerformanceSnapshotCockpitDir(workspaceRoot: string): string {
  return join(workspaceRoot, PERFORMANCE_SNAPSHOT_DIR);
}

export function listCampaignProjects(projects: Project[]): Project[] {
  return projects.filter((project) => project.purpose === "campaign");
}
