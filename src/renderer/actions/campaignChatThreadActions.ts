import { msg } from "@lingui/core/macro";
import { toast } from "@heroui/react";
import type { Project, Thread } from "@/shared/contracts";
import { resolveModelSelection } from "@/shared/agentSelection";
import { i18n } from "@/renderer/i18n/i18n";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { campaignWorkspaceKey } from "@/renderer/views/CampaignWorkspace/parts/campaignTopics";
import { findLegacyCampaignGuiThread } from "@/renderer/views/CampaignWorkspace/parts/campaignTopicThreads";
import { resolvePrimaryCampaignThread } from "@/renderer/views/CampaignWorkspace/parts/campaignThreadComposerRouting";
import {
  isCampaignChatThread,
  listCampaignChatThreads,
} from "@/renderer/views/CampaignWorkspace/parts/campaignChatThreads";

function resolveAgentAndModelForProject(project: Project | undefined): {
  agentKind: string;
  model: string;
} | null {
  const explicitKind = project?.campaignExtension?.defaultAgentKind;
  const explicitModel = project?.campaignExtension?.defaultModel;
  const statuses = useAgentStatusesStore.getState().agentStatuses;
  const installed = statuses.filter((status) => status.installed);

  if (installed.length === 0) return null;

  let agentStatus = explicitKind
    ? installed.find((status) => status.kind === explicitKind)
    : undefined;
  if (!agentStatus) agentStatus = installed[0];
  if (!agentStatus) return null;

  if (explicitModel) {
    const modelExists = agentStatus.capabilities.models.some((model) => model.id === explicitModel);
    if (modelExists) {
      return { agentKind: agentStatus.kind, model: explicitModel };
    }
  }

  const resolved = resolveModelSelection(agentStatus.capabilities);
  if (!resolved) return null;
  return { agentKind: agentStatus.kind, model: resolved };
}

function resolveDefaultsFromThreads(
  project: Project | undefined,
  projectThreads: Thread[],
): { agentKind: string; model: string } | null {
  const template =
    resolvePrimaryCampaignThread(projectThreads) ?? findLegacyCampaignGuiThread(projectThreads);
  if (template) {
    return { agentKind: template.agentKind, model: template.config.model };
  }
  return resolveAgentAndModelForProject(project);
}

async function persistThread(thread: Thread): Promise<void> {
  await readBridge().dbUpsertThread(thread);
}

/**
 * Create a new non-topic GUI chat thread in a campaign workspace.
 * Uses the project's default agent/model and the same persistence path as topics.
 */
export async function createCampaignChat(input: {
  projectId: string;
  campaignGroupId: string;
}): Promise<string | undefined> {
  const store = useAppStore.getState();
  const project = store.projects.find((entry) => entry.id === input.projectId);
  const projectThreads = store.threads.filter((thread) => thread.projectId === input.projectId);
  const defaults = resolveDefaultsFromThreads(project, projectThreads);
  if (!defaults) {
    toast.danger(i18n._(msg`No agent is available to create a chat.`));
    return undefined;
  }

  const title = i18n._(msg`New chat`);
  const thread = store.createThread({
    projectId: input.projectId,
    agentKind: defaults.agentKind as Thread["agentKind"],
    config: { model: defaults.model, mode: "agent" },
    prompt: "",
    title,
    presentationMode: "gui",
    focus: false,
  });

  try {
    await persistThread(thread);
  } catch {
    store.deleteThread(thread.id);
    toast.danger(i18n._(msg`Could not save the chat.`));
    return undefined;
  }

  const workspaceKey = campaignWorkspaceKey(input.projectId, input.campaignGroupId);
  store.setCampaignActiveChat(workspaceKey, thread.id);
  return thread.id;
}

/** Select an existing chat thread and remember it for this campaign workspace. */
export function selectCampaignChat(input: {
  projectId: string;
  campaignGroupId: string;
  threadId: string;
}): string | undefined {
  const store = useAppStore.getState();
  const thread = store.threads.find(
    (entry) =>
      entry.id === input.threadId &&
      entry.projectId === input.projectId &&
      isCampaignChatThread(entry),
  );
  if (!thread) return undefined;

  const workspaceKey = campaignWorkspaceKey(input.projectId, input.campaignGroupId);
  store.setCampaignActiveChat(workspaceKey, thread.id);
  return thread.id;
}

export function clearCampaignChatSelection(projectId: string, campaignGroupId: string): void {
  const workspaceKey = campaignWorkspaceKey(projectId, campaignGroupId);
  useAppStore.getState().setCampaignActiveChat(workspaceKey, null);
}

export function getActiveCampaignChatId(
  projectId: string,
  campaignGroupId: string,
): string | undefined {
  const workspaceKey = campaignWorkspaceKey(projectId, campaignGroupId);
  const threadId = useAppStore.getState().campaignActiveChatByKey[workspaceKey];
  if (!threadId) return undefined;

  const thread = useAppStore
    .getState()
    .threads.find(
      (entry) =>
        entry.id === threadId && entry.projectId === projectId && isCampaignChatThread(entry),
    );
  return thread?.id;
}

export function resolveCampaignChatThreads(projectId: string): Thread[] {
  const projectThreads = useAppStore
    .getState()
    .threads.filter((thread) => thread.projectId === projectId);
  return listCampaignChatThreads(projectThreads);
}
