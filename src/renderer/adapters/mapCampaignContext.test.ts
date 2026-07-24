import { describe, expect, it } from "vitest";
import { mapCampaignContext } from "./mapCampaignContext";
import {
  controlCentreCampaignContextFixture,
  controlCentreCampaignContextFixtureMinimal,
} from "@/shared/contracts/campaign/fixtures/controlCentreCampaignContext.fixture";

describe("mapCampaignContext", () => {
  it("maps identity.id → campaignGroupId", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.identity.campaignGroupId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("maps identity.name → campaignName", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.identity.campaignName).toBe("Q4 Brand Refresh");
  });

  it("maps identity.status → lifecycleStatus", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.identity.lifecycleStatus).toBe("live");
  });

  it("maps identity.startDate/endDate → dates object", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.dates.startDate).toBe("2026-10-01");
    expect(vm.dates.endDate).toBe("2026-12-31");
  });

  it("maps budget.percentUsed → budget.pctUsed (scaled to 0-100)", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.budget.pctUsed).toBe(45.5);
  });

  it("preserves null budget fields as null", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixtureMinimal);
    expect(vm.budget.totalBudget).toBeNull();
    expect(vm.budget.remaining).toBeNull();
    expect(vm.budget.pctUsed).toBeNull();
  });

  it("maps kpiTargets → kpis", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.kpis).toHaveLength(3);
    expect(vm.kpis[0]!.id).toBe("kpi-1");
    expect(vm.kpis[0]!.targetType).toBe("min");
    expect(vm.kpis[0]!.status).toBe("on_track");
  });

  it("uses metricKey as label when CC has no separate label", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.kpis[0]!.label).toBe("ctr");
    expect(vm.kpis[0]!.targetValue).toBe(2.0);
  });

  it("preserves null kpi actualValue as null", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    const kpi3 = vm.kpis.find((k) => k.metricKey === "reach");
    expect(kpi3!.actualValue).toBeNull();
  });

  it("maps channelExecutions → channels", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.channels).toHaveLength(3);
    expect(vm.channels[0]!.id).toBe("ch-1");
    expect(vm.channels[0]!.channelLabel).toBe("Meta Ads");
    expect(vm.channels[0]!.plannedBudget).toBe(60_000);
    expect(vm.channels[0]!.actualSpend).toBe(42_100);
  });

  it("maps sourceHealth fields to UI-friendly names", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.sourceHealth).toHaveLength(3);
    expect(vm.sourceHealth[0]!.sourceId).toBe("src-1");
    expect(vm.sourceHealth[0]!.label).toBe("Meta Business Account");
    expect(vm.sourceHealth[0]!.status).toBe("healthy");
    expect(vm.sourceHealth[0]!.lastSyncedAt).toBe("2026-11-20T06:05:00.000Z");
    expect(vm.sourceHealth[0]!.reason).toBeNull();
    expect(vm.sourceHealth[1]!.reason).toBe("Rate-limited by platform API");
  });

  it("sourceHealth status stays healthy|stale|failed (no 'unknown' default)", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    const statuses = vm.sourceHealth.map((s) => s.status);
    expect(statuses).toEqual(["healthy", "stale", "failed"]);
  });

  it("maps event createdAt → occurredAt and uses description→summary", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.recentEvents[0]!.occurredAt).toBe("2026-10-01T00:01:00.000Z");
    expect(vm.recentEvents[0]!.summary).toBe(
      "Media plan approved by client and pushed to channels.",
    );
  });

  it("falls back to event.title when description is null", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    const evt = vm.recentEvents.find((e) => e.eventType === "alert_opened");
    expect(evt!.summary).toBe("Overspend on Meta channel"); // falls back to title
  });

  it("preserves openAlerts with priorities", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.openAlerts).toHaveLength(3);
    expect(vm.openAlerts[0]!.priority).toBe("P1");
  });

  it("preserves activeDecisions as-is", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.activeDecisions).toHaveLength(1);
    expect(vm.activeDecisions[0]!.decisionType).toBe("budget_reallocation");
  });

  it("preserves pendingProposals with nullable riskLevel", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.pendingProposals).toHaveLength(2);
    expect(vm.pendingProposals[1]!.riskLevel).toBeNull();
  });

  it("derives evidenceFreshness from evidence.sources.freshnessStatus", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.evidenceFreshness).toContain("fresh");
    expect(vm.evidenceFreshness).toContain("stale");
  });

  it("derives missingDataWarnings when no budget is present", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixtureMinimal);
    expect(vm.missingDataWarnings).toContain("No budget configured");
    expect(vm.missingDataWarnings).toContain("No data sources connected");
    expect(vm.missingDataWarnings).toContain("No KPI targets set");
  });

  it("derives missingDataWarnings for stale/failed sources", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.missingDataWarnings).toContain("1 data sources have stale data");
    expect(vm.missingDataWarnings).toContain("1 data sources have failed to sync");
  });

  it("generatedAt is always undefined (CC does not send it on context)", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.generatedAt).toBeUndefined();
  });

  it("passes through suggestedQuestions", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.suggestedQuestions).toHaveLength(4);
  });

  it("handles null clientName gracefully (null preserved, not falsy '—' in view model data)", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixtureMinimal);
    expect(vm.identity.clientName).toBeNull();
  });

  it("hardcodes currency as GBP", () => {
    const vm = mapCampaignContext(controlCentreCampaignContextFixture);
    expect(vm.budget.currency).toBe("GBP");
  });
});
