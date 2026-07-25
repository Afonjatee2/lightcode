import type { ControlCentreCampaignContext } from "@/shared/contracts/campaign/controlCentreCampaignContext";
import type { CampaignContextViewModel } from "./campaignViewModels";

/**
 * Maps the Layer-1 exact CC wire schema to the Layer-2 UI-friendly view model.
 *
 * Key renames:
 *   identity.id            → campaignGroupId
 *   identity.name          → campaignName
 *   identity.status        → lifecycleStatus
 *   identity.startDate     → dates.startDate
 *   identity.endDate       → dates.endDate
 *   budget.percentUsed     → budget.pctUsed
 *   kpiTargets             → kpis
 *   channelExecutions      → channels
 *   sourceHealth[].sourceAccountId → sourceId
 *   sourceHealth[].sourceName      → label
 *   sourceHealth[].lastSuccessfulSyncAt → lastSyncedAt
 *   recentEvents[].title/description/createdAt → summary/occurredAt
 *
 * Derived warnings (NEVER on the wire contract):
 *   - no budget
 *   - no source accounts
 *   - stale/failed sources
 *   - no KPI targets
 */
export function mapCampaignContext(
  wire: ControlCentreCampaignContext,
): CampaignContextViewModel {
  // --- Evidence freshness summary --------------------------------------------
  const freshnessStatuses: string[] = [];
  for (const source of wire.evidence.flatMap((claim) => claim.sources)) {
    if (source.freshnessStatus && !freshnessStatuses.includes(source.freshnessStatus)) {
      freshnessStatuses.push(source.freshnessStatus);
    }
  }
  const evidenceFreshness = freshnessStatuses.join(", ") || "unknown";

  // --- Derived warnings -------------------------------------------------------
  const warnings: string[] = [];

  // Source strings stay macro-free here: this adapter is imported by a
  // node-environment test (mcpExtraction.test.ts), where the Lingui macro and
  // the `.po`-loading i18n singleton cannot run. They are localized at the
  // render boundary in CampaignContextPane.tsx.
  if (wire.budget.totalBudget === null || wire.budget.totalBudget === 0) {
    warnings.push("No budget configured");
  }
  if (wire.sourceHealth.length === 0) {
    warnings.push("No data sources connected");
  } else {
    const staleCount = wire.sourceHealth.filter((s) => s.status === "stale").length;
    const failedCount = wire.sourceHealth.filter((s) => s.status === "failed").length;
    if (staleCount > 0) {
      warnings.push(`${staleCount} data sources have stale data`);
    }
    if (failedCount > 0) {
      warnings.push(`${failedCount} data sources have failed to sync`);
    }
  }
  if (wire.kpiTargets.length === 0) {
    warnings.push("No KPI targets set");
  }

  // --- Pacing ----------------------------------------------------------------
  const pacingStatus = wire.budget.pacingStatus ?? "unknown";
  const expected = wire.budget.expectedPercentUsed;
  const percent = wire.budget.percentUsed;
  const variancePct: number | undefined =
    expected !== null && expected !== undefined && percent !== null && percent !== undefined
      ? Math.round((percent - expected) * 100)
      : undefined;

  return {
    identity: {
      campaignGroupId: wire.identity.id,
      campaignName: wire.identity.name,
      clientName: wire.identity.clientName,
      jobNumber: wire.identity.jobNumber,
      lifecycleStatus: wire.identity.status,
    },
    dates: {
      startDate: wire.identity.startDate,
      endDate: wire.identity.endDate,
    },
    budget: {
      currency: "GBP",
      totalBudget: wire.budget.totalBudget,
      spentToDate: wire.budget.spentToDate,
      remaining: wire.budget.remaining,
      pctUsed: wire.budget.percentUsed !== null ? wire.budget.percentUsed * 100 : null,
    },
    kpis: wire.kpiTargets.map((kpi) => ({
      id: kpi.id,
      metricKey: kpi.metricKey,
      label: kpi.metricKey,
      ...(kpi.channel !== undefined ? { channel: kpi.channel } : {}),
      targetType: kpi.targetType,
      targetValue: kpi.targetValue,
      actualValue: kpi.actualValue,
      pctAchieved: kpi.percentAchieved !== null ? kpi.percentAchieved * 100 : null,
      status: kpi.status,
    })),
    pacing: {
      status: pacingStatus,
      variancePct,
      note: undefined,
    },
    channels: wire.channelExecutions.map((ch) => ({
      id: ch.id,
      channelLabel: ch.channelLabel,
      platform: ch.platform,
      plannedBudget: ch.plannedBudget,
      actualSpend: ch.actualSpend,
      status: ch.status,
    })),
    sourceHealth: wire.sourceHealth.map((src) => ({
      sourceId: src.sourceAccountId,
      label: src.sourceName,
      status: src.status,
      lastSyncedAt: src.lastSuccessfulSyncAt,
      reason: src.reason,
    })),
    openAlerts: wire.openAlerts.map((alert) => ({
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      priority: alert.priority,
      openedAt: alert.openedAt,
    })),
    activeDecisions: wire.activeDecisions.map((dec) => ({
      id: dec.id,
      title: dec.title,
      decisionType: dec.decisionType,
      status: dec.status,
      createdAt: dec.createdAt,
    })),
    pendingProposals: wire.pendingProposals.map((prop) => ({
      id: prop.id,
      title: prop.title,
      status: prop.status,
      riskLevel: prop.riskLevel,
      createdAt: prop.createdAt,
    })),
    recentEvents: wire.recentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      summary: event.description ?? event.title,
      occurredAt: event.createdAt,
    })),
    evidenceFreshness,
    missingDataWarnings: warnings,
    generatedAt: undefined,
    suggestedQuestions: wire.suggestedQuestions,
  };
}
