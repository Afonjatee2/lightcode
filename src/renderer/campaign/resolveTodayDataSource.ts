import type { McpServer, Project, Thread } from "@/shared/contracts";
import { getProjectPurpose } from "@/shared/contracts/project";
import { resolveControlCentreServer } from "@/renderer/hooks/useControlCentreTool";

/** Latest thread activity for a project, falling back to project creation time. */
export function projectActivityTimestamp(project: Project, threads: readonly Thread[]): string {
  let latest = project.createdAt;
  for (const thread of threads) {
    if (thread.projectId !== project.id) continue;
    if (thread.updatedAt.localeCompare(latest) > 0) {
      latest = thread.updatedAt;
    }
  }
  return latest;
}

function isCampaignProjectWithControlCentre(
  project: Project,
  userMcpServers: readonly McpServer[],
): boolean {
  if (getProjectPurpose(project) !== "campaign") return false;
  return resolveControlCentreServer(project, userMcpServers) !== undefined;
}

/**
 * Picks the campaign project whose Control Centre MCP config should back the
 * app-level Today home. Deterministic: most recently active campaign project
 * with a configured Control Centre server.
 */
export function selectTodayDataProject(
  projects: readonly Project[],
  userMcpServers: readonly McpServer[],
  threads: readonly Thread[],
): string | undefined {
  const candidates = projects.filter((project) =>
    isCampaignProjectWithControlCentre(project, userMcpServers),
  );
  if (candidates.length === 0) return undefined;

  const sorted = [...candidates].sort((a, b) =>
    projectActivityTimestamp(b, threads).localeCompare(projectActivityTimestamp(a, threads)),
  );
  return sorted[0]?.id;
}

/** Maps a Control Centre campaign group id to a local campaign project, if any. */
export function findCampaignProjectByGroupId(
  projects: readonly Project[],
  campaignGroupId: string,
): Project | undefined {
  return projects.find(
    (project) =>
      getProjectPurpose(project) === "campaign" &&
      project.campaignExtension?.campaignGroupId === campaignGroupId,
  );
}
