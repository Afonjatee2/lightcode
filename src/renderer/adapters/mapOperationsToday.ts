import type { ControlCentreOperationsToday } from "@/shared/contracts/campaign/controlCentreOperationsToday";
import type {
  OperationsTodayCampaignViewModel,
  OperationsTodayViewModel,
} from "./campaignViewModels";

/**
 * Derives a human-readable source health string from the structured summary.
 * Null-safe — returns "—" when no data.
 */
function formatSourceHealthSummary(
  summary: { healthy: number; stale: number; failed: number },
): string {
  const { healthy, stale: st, failed: fl } = summary;
  if (healthy + st + fl === 0) return "—";
  const parts: string[] = [];
  if (healthy > 0) parts.push(`${healthy} healthy`);
  if (st > 0) parts.push(`${st} stale`);
  if (fl > 0) parts.push(`${fl} failed`);
  return parts.join(", ");
}

/**
 * Maps a single CC operations group entry to the UI-friendly view model.
 */
function mapGroupEntry(
  entry: {
    campaignGroupId: string;
    name: string;
    clientName: string | null;
    status: string;
    deliveryState: "delivering" | "stale" | "unavailable" | "unknown";
    openAlerts: number;
    pendingProposals: number;
    sourceHealthSummary: { healthy: number; stale: number; failed: number };
    lastDataFreshnessAt: string | null;
    topPriority?: "P1" | "P2" | "P3" | "P4";
  },
  attentionReason: string | undefined,
): OperationsTodayCampaignViewModel {
  return {
    campaignGroupId: entry.campaignGroupId,
    clientName: entry.clientName ?? "—",
    campaignName: entry.name,
    lifecycleStatus: entry.status,
    deliveryState: entry.deliveryState,
    attentionReason,
    openAlertCount: entry.openAlerts,
    pendingProposalCount: entry.pendingProposals,
    sourceHealthSummary: formatSourceHealthSummary(entry.sourceHealthSummary),
    lastSyncedAt: entry.lastDataFreshnessAt,
    ...(entry.topPriority ? { topPriority: entry.topPriority } : {}),
  };
}

/**
 * Maps the Layer-1 exact CC wire schema (OperationsTodayView) to the
 * Layer-2 UI-friendly view model with derived counts.
 *
 * Counts are DERIVED from array lengths — CC does NOT send a `counts` object.
 */
export function mapOperationsToday(
  wire: ControlCentreOperationsToday,
): OperationsTodayViewModel {
  const needsAttention = wire.needsAttention.map((entry) =>
    mapGroupEntry(entry, entry.attentionReason),
  );
  const waitingForApproval = wire.waitingForApproval.map((entry) =>
    mapGroupEntry(entry, entry.attentionReason),
  );
  const otherLive = wire.otherLive.map((entry) => mapGroupEntry(entry, undefined));

  return {
    needsAttention,
    waitingForApproval,
    otherLive,
    counts: {
      needsAttention: needsAttention.length,
      waitingForApproval: waitingForApproval.length,
      otherLive: otherLive.length,
      total: needsAttention.length + waitingForApproval.length + otherLive.length,
    },
    generatedAt: wire.generatedAt,
    healthyCampaignCount: wire.healthyCampaignCount,
    sourceHealthSummary: { ...wire.sourceHealthSummary },
    recentlyResolved: wire.recentlyResolved.map((res) => ({
      campaignGroupId: res.campaignGroupId,
      name: res.name,
      alertId: res.alertId,
      resolvedAt: res.resolvedAt,
    })),
  };
}
