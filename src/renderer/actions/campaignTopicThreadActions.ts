import { msg } from "@lingui/core/macro";
import { toast } from "@heroui/react";
import type { Project, Thread } from "@/shared/contracts";
import { resolveModelSelection } from "@/shared/agentSelection";
import { i18n } from "@/renderer/i18n/i18n";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import {
  CAMPAIGN_TOPICS,
  type CampaignTopicId,
  campaignTopicGroupId,
  campaignWorkspaceKey,
} from "@/renderer/views/CampaignWorkspace/parts/campaignTopics";
import {
  findLegacyCampaignGuiThread,
  isCampaignTopicThread,
  resolveCampaignTopicThread,
} from "@/renderer/views/CampaignWorkspace/parts/campaignTopicThreads";
import { resolvePrimaryCampaignThread } from "@/renderer/views/CampaignWorkspace/parts/campaignThreadComposerRouting";

function topicLabel(topicId: CampaignTopicId): string {
  const topic = CAMPAIGN_TOPICS.find((entry) => entry.id === topicId);
  return topic ? i18n._(topic.label) : topicId;
}

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

function tagThreadAsCampaignTopic(
  threadId: string,
  topicId: CampaignTopicId,
  label: string,
): Thread {
  const groupId = campaignTopicGroupId(topicId);
  const now = new Date().toISOString();
  let tagged: Thread | undefined;
  useAppStore.setState((state) => ({
    threads: state.threads.map((thread) => {
      if (thread.id !== threadId) return thread;
      tagged = { ...thread, groupId, groupName: label, title: label, updatedAt: now };
      return tagged;
    }),
  }));
  if (!tagged) {
    throw new Error(`Thread ${threadId} was not found while tagging a campaign topic.`);
  }
  return tagged;
}

async function persistThread(thread: Thread): Promise<void> {
  await readBridge().dbUpsertThread(thread);
}

async function adoptLegacyThreadForTopic(
  thread: Thread,
  topicId: CampaignTopicId,
): Promise<Thread> {
  const label = topicLabel(topicId);
  const tagged = tagThreadAsCampaignTopic(thread.id, topicId, label);
  await persistThread(tagged);
  return tagged;
}

async function createCampaignTopicThread(
  projectId: string,
  topicId: CampaignTopicId,
): Promise<Thread | undefined> {
  const store = useAppStore.getState();
  const project = store.projects.find((entry) => entry.id === projectId);
  const projectThreads = store.threads.filter((thread) => thread.projectId === projectId);
  const defaults = resolveDefaultsFromThreads(project, projectThreads);
  if (!defaults) {
    toast.danger(i18n._(msg`No agent is available to create this topic thread.`));
    return undefined;
  }

  const label = topicLabel(topicId);
  const thread = store.createThread({
    projectId,
    agentKind: defaults.agentKind as Thread["agentKind"],
    config: { model: defaults.model, mode: "agent" },
    prompt: "",
    title: label,
    presentationMode: "gui",
    groupId: campaignTopicGroupId(topicId),
    groupName: label,
    focus: false,
  });

  try {
    await persistThread(thread);
    return thread;
  } catch {
    store.deleteThread(thread.id);
    toast.danger(i18n._(msg`Could not save the topic thread.`));
    return undefined;
  }
}

/**
 * Select a campaign topic tab, lazily creating or adopting its backing thread.
 * Returns the resolved thread id when successful.
 */
export async function selectCampaignTopic(input: {
  projectId: string;
  campaignGroupId: string;
  topicId: CampaignTopicId;
}): Promise<string | undefined> {
  const store = useAppStore.getState();
  const workspaceKey = campaignWorkspaceKey(input.projectId, input.campaignGroupId);
  store.setCampaignActiveTopic(workspaceKey, input.topicId);

  const projectThreads = store.threads.filter(
    (thread) => thread.projectId === input.projectId && !thread.archived,
  );

  let thread = resolveCampaignTopicThread(projectThreads, input.topicId);
  if (!thread) {
    thread = await createCampaignTopicThread(input.projectId, input.topicId);
  } else if (!isCampaignTopicThread(thread)) {
    thread = await adoptLegacyThreadForTopic(thread, input.topicId);
  }

  if (!thread) return undefined;
  store.markCampaignTopicViewed(thread.id);
  return thread.id;
}

export function getActiveCampaignTopicId(
  projectId: string,
  campaignGroupId: string,
): CampaignTopicId {
  const workspaceKey = campaignWorkspaceKey(projectId, campaignGroupId);
  return useAppStore.getState().campaignActiveTopicByKey[workspaceKey] ?? "monitoring";
}
