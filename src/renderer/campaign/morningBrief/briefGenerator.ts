import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import type { OperationsTodayViewModel } from "@/renderer/adapters/campaignViewModels";

export type ExceptionType =
  | "critical_high_alert"
  | "no_spend"
  | "rejected_ad"
  | "proposal_awaiting"
  | "failed_action";

export interface MorningBriefItem {
  /** Unique item key used for de-duplication across runs. */
  id: string;
  campaignGroupId: string;
  clientName: string;
  campaignName: string;
  kind: "needs_attention" | "waiting_for_approval";
  topPriority?: "P1" | "P2" | "P3" | "P4";
  reason: string;
  isException: boolean;
  exceptionType?: ExceptionType;
  pendingProposalCount?: number;
}

export interface MorningBrief {
  generatedAt: string;
  counts: {
    needsAttention: number;
    waitingForApproval: number;
    otherLive: number;
    healthy: number;
    total: number;
  };
  healthNote: string;
  topNeedsAttention: MorningBriefItem[];
  topWaitingForApproval: MorningBriefItem[];
  exceptions: MorningBriefItem[];
  hasExceptions: boolean;
}

export function classifyNeedsAttentionException(
  topPriority: "P1" | "P2" | "P3" | "P4" | undefined,
  reason: string,
): { isException: boolean; exceptionType?: ExceptionType } {
  if (topPriority === "P1" || topPriority === "P2") {
    return { isException: true, exceptionType: "critical_high_alert" };
  }
  const lower = reason.toLowerCase();
  if (
    lower.includes("did not spend") ||
    lower.includes("no spend") ||
    lower.includes("zero spend") ||
    lower.includes("unspent")
  ) {
    return { isException: true, exceptionType: "no_spend" };
  }
  if (lower.includes("rejected")) {
    return { isException: true, exceptionType: "rejected_ad" };
  }
  if (lower.includes("failed") || lower.includes("error")) {
    return { isException: true, exceptionType: "failed_action" };
  }
  return { isException: false };
}

export function classifyWaitingForApprovalException(pendingProposalCount: number): {
  isException: boolean;
  exceptionType?: ExceptionType;
} {
  if (pendingProposalCount > 0) {
    return { isException: true, exceptionType: "proposal_awaiting" };
  }
  return { isException: false };
}

export function formatHealthNote(summary: {
  healthy: number;
  stale: number;
  failed: number;
}): string {
  const { healthy, stale, failed } = summary;
  if (healthy + stale + failed === 0) return "—";
  if (stale === 0 && failed === 0) {
    return i18n._(msg`${healthy} healthy`);
  }
  const parts: string[] = [];
  if (healthy > 0) parts.push(i18n._(msg`${healthy} healthy`));
  if (stale > 0) parts.push(i18n._(msg`${stale} stale`));
  if (failed > 0) parts.push(i18n._(msg`${failed} failed`));
  return parts.join(", ");
}

export interface GenerateMorningBriefOptions {
  maxItemsPerSection?: number;
}

/**
 * Pure generator function turning the operations/today payload into a compact
 * morning brief summary with capped top items, a health note, and explicit exception items.
 */
export function generateMorningBrief(
  payload: OperationsTodayViewModel,
  options?: GenerateMorningBriefOptions,
): MorningBrief {
  const maxItems = options?.maxItemsPerSection ?? 3;

  const needsAttentionItems: MorningBriefItem[] = payload.needsAttention.map((item) => {
    const reason = item.attentionReason ?? item.campaignName;
    const classification = classifyNeedsAttentionException(item.topPriority, reason);
    // Stable identity only: reason text and counts move as the backend
    // rewords or re-counts, and anything volatile in the key makes the same
    // underlying exception notify again every time it shifts.
    const id = classification.isException
      ? `${item.campaignGroupId}:${classification.exceptionType}`
      : `${item.campaignGroupId}:needs_attention`;
    return {
      id,
      campaignGroupId: item.campaignGroupId,
      clientName: item.clientName,
      campaignName: item.campaignName,
      kind: "needs_attention",
      ...(item.topPriority ? { topPriority: item.topPriority } : {}),
      reason,
      isException: classification.isException,
      ...(classification.exceptionType ? { exceptionType: classification.exceptionType } : {}),
    };
  });

  const waitingForApprovalItems: MorningBriefItem[] = payload.waitingForApproval.map((item) => {
    const reason =
      item.attentionReason ?? `${item.pendingProposalCount} proposals awaiting approval`;
    const classification = classifyWaitingForApprovalException(item.pendingProposalCount);
    const id = classification.isException
      ? `${item.campaignGroupId}:proposal`
      : `${item.campaignGroupId}:waiting_approval`;
    return {
      id,
      campaignGroupId: item.campaignGroupId,
      clientName: item.clientName,
      campaignName: item.campaignName,
      kind: "waiting_for_approval",
      reason,
      isException: classification.isException,
      ...(classification.exceptionType ? { exceptionType: classification.exceptionType } : {}),
      pendingProposalCount: item.pendingProposalCount,
    };
  });

  const allItems = [...needsAttentionItems, ...waitingForApprovalItems];
  const exceptions = allItems.filter((item) => item.isException);

  return {
    generatedAt: payload.generatedAt,
    counts: {
      needsAttention: payload.counts.needsAttention,
      waitingForApproval: payload.counts.waitingForApproval,
      otherLive: payload.counts.otherLive,
      healthy: payload.healthyCampaignCount,
      total: payload.counts.total,
    },
    healthNote: formatHealthNote(payload.sourceHealthSummary),
    topNeedsAttention: needsAttentionItems.slice(0, maxItems),
    topWaitingForApproval: waitingForApprovalItems.slice(0, maxItems),
    exceptions,
    hasExceptions: exceptions.length > 0,
  };
}

/**
 * Filter out exception items that have already been notified.
 */
export function filterNewExceptions(
  exceptions: MorningBriefItem[],
  notifiedKeys: Iterable<string>,
): MorningBriefItem[] {
  const set = notifiedKeys instanceof Set ? notifiedKeys : new Set(notifiedKeys);
  return exceptions.filter((item) => !set.has(item.id));
}
