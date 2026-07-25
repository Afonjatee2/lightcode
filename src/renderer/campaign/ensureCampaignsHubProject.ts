import { msg } from "@lingui/core/macro";
import type { Project } from "@/shared/contracts";
import { getProjectPurpose } from "@/shared/contracts/project";
import { i18n } from "@/renderer/i18n/i18n";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { resolveAgentAndModelForCampaign } from "@/renderer/actions/campaignProjectActions";

export const CAMPAIGNS_HUB_GROUP_ID = "poracode-campaigns-hub";
export const CAMPAIGNS_HUB_PROJECT_NAME = "Campaigns";

export function findCampaignsHubProject(projects: readonly Project[]): Project | undefined {
  return projects.find(
    (project) =>
      getProjectPurpose(project) === "campaign" &&
      project.campaignExtension?.campaignGroupId === CAMPAIGNS_HUB_GROUP_ID,
  );
}

export type EnsureCampaignsHubOutcome =
  | { ok: true; projectId: string; threadId: string }
  | { ok: false; error: string };

/**
 * Lightweight cross-campaign workspace used when Today ask-anything runs before
 * any pinned campaign workspace exists. Not bound to a live Control Centre group.
 */
export async function ensureCampaignsHubProject(): Promise<EnsureCampaignsHubOutcome> {
  const store = useAppStore.getState();
  const existing = findCampaignsHubProject(store.projects);
  if (existing) {
    const thread = store.threads.find(
      (entry) =>
        entry.projectId === existing.id && entry.presentationMode === "gui" && !entry.archived,
    );
    if (thread) {
      return { ok: true, projectId: existing.id, threadId: thread.id };
    }

    const resolved = resolveAgentAndModelForCampaign(undefined, undefined);
    if ("error" in resolved) return { ok: false, error: resolved.error };

    try {
      const created = store.createThread({
        projectId: existing.id,
        agentKind: resolved.agentKind,
        config: { model: resolved.model, mode: "agent" },
        prompt: "",
        title: existing.name,
        presentationMode: "gui",
        focus: true,
      });
      await readBridge().dbUpsertThread(created);
      return { ok: true, projectId: existing.id, threadId: created.id };
    } catch {
      return {
        ok: false,
        error: i18n._(msg`Could not create a thread for the campaigns workspace.`),
      };
    }
  }

  const projectId = crypto.randomUUID();
  let location;
  try {
    const result = await readBridge().ensureCampaignWorkspaceDir({
      projectId,
      name: CAMPAIGNS_HUB_PROJECT_NAME,
    });
    location = result.location;
  } catch {
    return {
      ok: false,
      error: i18n._(msg`Could not create the campaigns workspace directory.`),
    };
  }

  const project = store.addCampaignProject(
    location,
    {
      campaignGroupId: CAMPAIGNS_HUB_GROUP_ID,
      clientName: "All campaigns",
      campaignName: CAMPAIGNS_HUB_PROJECT_NAME,
      mcpProfile: "monitoring",
    },
    CAMPAIGNS_HUB_PROJECT_NAME,
    projectId,
  );

  try {
    await readBridge().dbUpsertProject(project);
  } catch {
    store.deleteProject(project.id);
    return { ok: false, error: i18n._(msg`Could not save the campaigns workspace.`) };
  }

  const resolved = resolveAgentAndModelForCampaign(undefined, undefined);
  if ("error" in resolved) {
    store.deleteProject(project.id);
    return { ok: false, error: resolved.error };
  }

  try {
    const thread = store.createThread({
      projectId: project.id,
      agentKind: resolved.agentKind,
      config: { model: resolved.model, mode: "agent" },
      prompt: "",
      title: project.name,
      presentationMode: "gui",
      focus: true,
    });
    await readBridge().dbUpsertThread(thread);
    return { ok: true, projectId: project.id, threadId: thread.id };
  } catch {
    store.deleteProject(project.id);
    return {
      ok: false,
      error: i18n._(msg`Could not create the campaigns workspace thread.`),
    };
  }
}
