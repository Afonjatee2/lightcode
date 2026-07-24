import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export const CAMPAIGN_TOPIC_GROUP_PREFIX = "campaign-topic:" as const;

export const CAMPAIGN_TOPIC_IDS = [
  "monitoring",
  "pacing",
  "plan_revision",
  "client_update",
  "eoc_report",
  "general",
] as const;

export type CampaignTopicId = (typeof CAMPAIGN_TOPIC_IDS)[number];

export type CampaignTopicDefinition = {
  id: CampaignTopicId;
  label: MessageDescriptor;
  order: number;
};

export const CAMPAIGN_TOPICS: readonly CampaignTopicDefinition[] = [
  { id: "monitoring", label: msg`Monitoring`, order: 0 },
  { id: "pacing", label: msg`Pacing`, order: 1 },
  { id: "plan_revision", label: msg`Plan Revision`, order: 2 },
  { id: "client_update", label: msg`Client Update`, order: 3 },
  { id: "eoc_report", label: msg`EOC Report`, order: 4 },
  { id: "general", label: msg`General`, order: 5 },
] as const;

const TOPIC_ID_SET = new Set<string>(CAMPAIGN_TOPIC_IDS);

export function isCampaignTopicId(value: string): value is CampaignTopicId {
  return TOPIC_ID_SET.has(value);
}

export function campaignTopicGroupId(topicId: CampaignTopicId): string {
  return `${CAMPAIGN_TOPIC_GROUP_PREFIX}${topicId}`;
}

export function parseCampaignTopicIdFromGroupId(
  groupId: string | undefined,
): CampaignTopicId | null {
  if (!groupId?.startsWith(CAMPAIGN_TOPIC_GROUP_PREFIX)) return null;
  const topicId = groupId.slice(CAMPAIGN_TOPIC_GROUP_PREFIX.length);
  return isCampaignTopicId(topicId) ? topicId : null;
}

export function campaignWorkspaceKey(projectId: string, campaignGroupId: string): string {
  return `${projectId}::${campaignGroupId}`;
}

export const DEFAULT_CAMPAIGN_TOPIC_ID: CampaignTopicId = "monitoring";
