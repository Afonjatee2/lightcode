import type { Thread } from "@/shared/contracts";
import type { ConsultationRecord } from "@/shared/consultations";
import {
  CAMPAIGN_TOPIC_GROUP_PREFIX,
  type CampaignTopicId,
  campaignTopicGroupId,
  parseCampaignTopicIdFromGroupId,
} from "./campaignTopics";
import { resolvePrimaryCampaignThread } from "./campaignThreadComposerRouting";

export function isCampaignTopicThread(thread: Thread): boolean {
  return thread.groupId?.startsWith(CAMPAIGN_TOPIC_GROUP_PREFIX) ?? false;
}

export function findThreadForCampaignTopic(
  threads: readonly Thread[],
  topicId: CampaignTopicId,
): Thread | undefined {
  const groupId = campaignTopicGroupId(topicId);
  return threads.find(
    (thread) =>
      !thread.archived &&
      !thread.done &&
      thread.presentationMode === "gui" &&
      thread.groupId === groupId,
  );
}

/**
 * Oldest non-archived GUI thread that is not already tagged as a campaign topic.
 * Used to adopt the initial thread created with a campaign project as Monitoring.
 */
export function findLegacyCampaignGuiThread(threads: readonly Thread[]): Thread | undefined {
  const legacy = threads.filter(
    (thread) =>
      !thread.archived &&
      !thread.done &&
      thread.presentationMode === "gui" &&
      !isCampaignTopicThread(thread),
  );
  return resolvePrimaryCampaignThread(legacy);
}

export function resolveCampaignTopicThread(
  threads: readonly Thread[],
  topicId: CampaignTopicId,
): Thread | undefined {
  const tagged = findThreadForCampaignTopic(threads, topicId);
  if (tagged) return tagged;
  if (topicId === "monitoring") {
    return findLegacyCampaignGuiThread(threads);
  }
  return undefined;
}

export function indexCampaignTopicThreads(
  threads: readonly Thread[],
): Partial<Record<CampaignTopicId, Thread>> {
  const byTopic: Partial<Record<CampaignTopicId, Thread>> = {};
  for (const thread of threads) {
    if (thread.archived || thread.done || thread.presentationMode !== "gui") continue;
    const topicId = parseCampaignTopicIdFromGroupId(thread.groupId);
    if (!topicId || byTopic[topicId]) continue;
    byTopic[topicId] = thread;
  }
  const legacy = findLegacyCampaignGuiThread(threads);
  if (legacy && !byTopic.monitoring) {
    byTopic.monitoring = legacy;
  }
  return byTopic;
}

export function getCampaignTopicActivityAt(
  thread: Thread,
  consultationRecords: Iterable<ConsultationRecord>,
): number {
  let activityAt = new Date(thread.updatedAt).getTime();
  for (const record of consultationRecords) {
    if (record.parentThreadId !== thread.id) continue;
    activityAt = Math.max(activityAt, new Date(record.createdAt).getTime());
    if (record.completedAt) {
      activityAt = Math.max(activityAt, new Date(record.completedAt).getTime());
    }
  }
  return activityAt;
}

export function isCampaignTopicUnread(input: {
  thread: Thread | undefined;
  isActive: boolean;
  lastViewedAtMs: number | undefined;
  consultationRecords: Iterable<ConsultationRecord>;
}): boolean {
  const { thread, isActive, lastViewedAtMs, consultationRecords } = input;
  if (!thread || isActive) return false;
  const viewedAt = lastViewedAtMs ?? 0;
  const activityAt = getCampaignTopicActivityAt(thread, consultationRecords);
  const createdAt = new Date(thread.createdAt).getTime();
  if (activityAt <= createdAt) return false;
  return activityAt > viewedAt;
}
