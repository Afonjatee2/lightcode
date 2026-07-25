import type { McpServer, Project, Thread } from "@/shared/contracts";
import { diagnoseControlCentreMcpSetup, mergeMcpServers } from "@/shared/contracts";
import { getProjectPurpose } from "@/shared/contracts/project";
import { resolveControlCentreServer } from "@/renderer/hooks/useControlCentreTool";
import type { ControlCentreUnavailableReason } from "@/renderer/campaign/controlCentreAvailabilityCopy";
import type { OperationsTodayViewModel } from "@/renderer/adapters/campaignViewModels";

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

/**
 * When Today has campaign projects but none with an enabled Control Centre MCP
 * server, distinguishes a missing server from a disabled one.
 */
export function diagnoseTodayControlCentreSetup(
  projects: readonly Project[],
  userMcpServers: readonly McpServer[],
): Exclude<ControlCentreUnavailableReason, "connection-failed"> {
  let sawDisabled = false;
  for (const project of projects) {
    if (getProjectPurpose(project) !== "campaign") continue;
    const setup = diagnoseControlCentreMcpSetup(
      mergeMcpServers(userMcpServers, project.mcpServers ?? []),
    );
    if (setup.kind === "ready") {
      continue;
    }
    if (setup.kind === "disabled") {
      sawDisabled = true;
    }
  }

  const globalSetup = diagnoseControlCentreMcpSetup(userMcpServers);
  if (globalSetup.kind === "disabled") {
    sawDisabled = true;
  }

  return sawDisabled ? "disabled" : "not-configured";
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

/** Picks a default campaign group for cross-campaign ask-anything routing. */
export function pickDefaultCampaignGroupId(
  data: OperationsTodayViewModel | undefined,
): string | undefined {
  if (!data) return undefined;
  const first = data.needsAttention[0] ?? data.waitingForApproval[0] ?? data.otherLive[0];
  return first?.campaignGroupId;
}
