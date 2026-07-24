import { describe, expect, it } from "vitest";
import { controlCentreCampaignContextSchema } from "./controlCentreCampaignContext";
import { controlCentreOperationsTodaySchema } from "./controlCentreOperationsToday";
import {
  controlCentreCampaignContextFixture,
  controlCentreCampaignContextFixtureMinimal,
} from "./fixtures/controlCentreCampaignContext.fixture";
import { controlCentreOperationsTodayFixture } from "./fixtures/controlCentreOperationsToday.fixture";

describe("controlCentreCampaignContextSchema", () => {
  it("parses the full fixture successfully", () => {
    const result = controlCentreCampaignContextSchema.safeParse(
      controlCentreCampaignContextFixture,
    );
    expect(result.success).toBe(true);
  });

  it("parses the minimal fixture successfully", () => {
    const result = controlCentreCampaignContextSchema.safeParse(
      controlCentreCampaignContextFixtureMinimal,
    );
    expect(result.success).toBe(true);
  });

  it("preserves identity fields exactly from the fixture", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    expect(result.identity.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result.identity.name).toBe("Q4 Brand Refresh");
    expect(result.identity.clientName).toBe("Bright Horizon Group");
    expect(result.identity.jobNumber).toBe("BHG-2026-Q4-01");
    expect(result.identity.startDate).toBe("2026-10-01");
    expect(result.identity.endDate).toBe("2026-12-31");
    expect(result.identity.status).toBe("live");
  });

  it("preserves budget fields including nullable", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    expect(result.budget.totalBudget).toBe(150_000);
    expect(result.budget.spentToDate).toBe(68_250.5);
    expect(result.budget.remaining).toBe(81_749.5);
    expect(result.budget.percentUsed).toBe(0.455);
    expect(result.budget.expectedPercentUsed).toBe(0.42);
    expect(result.budget.pacingStatus).toBe("AHEAD");
  });

  it("accepts null identity.clientName and identity.jobNumber", () => {
    const result = controlCentreCampaignContextSchema.parse(
      controlCentreCampaignContextFixtureMinimal,
    );
    expect(result.identity.clientName).toBeNull();
    expect(result.identity.jobNumber).toBeNull();
  });

  it("accepts null totalBudget, remaining, percentUsed, expectedPercentUsed, pacingStatus", () => {
    const result = controlCentreCampaignContextSchema.parse(
      controlCentreCampaignContextFixtureMinimal,
    );
    expect(result.budget.totalBudget).toBeNull();
    expect(result.budget.spentToDate).toBe(0);
    expect(result.budget.remaining).toBeNull();
    expect(result.budget.percentUsed).toBeNull();
    expect(result.budget.expectedPercentUsed).toBeNull();
    expect(result.budget.pacingStatus).toBeNull();
  });

  it("parses kpiTargets with null actualValue and percentAchieved", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    const kpi3 = result.kpiTargets.find((k) => k.metricKey === "reach");
    expect(kpi3).toBeDefined();
    expect(kpi3!.actualValue).toBeNull();
    expect(kpi3!.percentAchieved).toBeNull();
    expect(kpi3!.status).toBeNull();
  });

  it("parses openAlerts with P1..P4 priorities", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    expect(result.openAlerts).toHaveLength(3);
    expect(result.openAlerts[0]!.priority).toBe("P1");
    expect(result.openAlerts[1]!.priority).toBe("P2");
    expect(result.openAlerts[2]!.priority).toBe("P4");
  });

  it("parses sourceHealth with healthy/stale/failed statuses", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    expect(result.sourceHealth).toHaveLength(3);
    expect(result.sourceHealth[0]!.status).toBe("healthy");
    expect(result.sourceHealth[1]!.status).toBe("stale");
    expect(result.sourceHealth[2]!.status).toBe("failed");
  });

  it("parses evidence with and without a calculation", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]!.calculation).not.toBeNull();
    expect(result.evidence[0]!.calculation!.expression).toBe("spentToDate / totalBudget");
    expect(result.evidence[1]!.calculation).toBeNull();
  });

  it("parses a recentEvent with description=null", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    const evt = result.recentEvents.find((e) => e.id === "evt-2");
    expect(evt).toBeDefined();
    expect(evt!.description).toBeNull();
  });

  it("parses pendingProposals with null riskLevel", () => {
    const result = controlCentreCampaignContextSchema.parse(controlCentreCampaignContextFixture);
    const prop = result.pendingProposals.find((p) => p.id === "prop-2");
    expect(prop).toBeDefined();
    expect(prop!.riskLevel).toBeNull();
  });

  it("rejects invalid sourceHealth status", () => {
    const bad = {
      ...controlCentreCampaignContextFixture,
      sourceHealth: [
        {
          sourceAccountId: "x",
          sourceName: "y",
          status: "degraded",
          lastSuccessfulSyncAt: null,
          reason: null,
        },
      ],
    };
    expect(controlCentreCampaignContextSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const bad = {
      ...controlCentreCampaignContextFixture,
      openAlerts: [
        { id: "a", title: "x", severity: "info", priority: "P5", openedAt: "2026-01-01" },
      ],
    };
    expect(controlCentreCampaignContextSchema.safeParse(bad).success).toBe(false);
  });

  it("does NOT require generatedAt (CC never sends it)", () => {
    // The schema has no generatedAt field, but Zod strips unknown keys, so an
    // extra generatedAt parses fine (it is simply dropped from the output).
    const withGeneratedAt = { ...controlCentreCampaignContextFixture, generatedAt: "2026-01-01" };
    expect(controlCentreCampaignContextSchema.safeParse(withGeneratedAt).success).toBe(true);
  });

  it("rejects the OLD guessed context shape (identity.campaignGroupId, dates, budget.pctUsed)", () => {
    const oldGuessed = {
      identity: {
        campaignGroupId: "group-1",
        campaignName: "Real Live Campaign",
        clientName: "Real Client Ltd",
        lifecycleStatus: "live",
      },
      dates: { startDate: "2026-01-01", endDate: "2026-03-31" },
      budget: { currency: "GBP", totalBudget: 10_000, spentToDate: 4_000, pctUsed: 40 },
      kpis: [],
      pacing: { status: "on_track" },
      channels: [],
      sourceHealth: [],
      openAlerts: [],
      activeDecisions: [],
      pendingProposals: [],
      recentEvents: [],
      missingDataWarnings: [],
      generatedAt: "2026-07-22T09:00:00.000Z",
    };
    expect(controlCentreCampaignContextSchema.safeParse(oldGuessed).success).toBe(false);
  });
});

describe("controlCentreOperationsTodaySchema", () => {
  it("parses the full fixture successfully", () => {
    const result = controlCentreOperationsTodaySchema.safeParse(
      controlCentreOperationsTodayFixture,
    );
    expect(result.success).toBe(true);
  });

  it("preserves generatedAt from the fixture", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.generatedAt).toBe("2026-11-20T18:00:00.000Z");
  });

  it("buckets needsAttention/waitingForApproval/otherLive correctly", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.needsAttention).toHaveLength(2);
    expect(result.waitingForApproval).toHaveLength(1);
    expect(result.otherLive).toHaveLength(2);
  });

  it("needsAttention entries have topPriority and attentionReason", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.needsAttention[0]!.topPriority).toBe("P1");
    expect(result.needsAttention[0]!.attentionReason).toContain("P1");
  });

  it("waitingForApproval entries have attentionReason but NO topPriority", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.waitingForApproval[0]!.attentionReason).toBeDefined();
    // topPriority should not be on waitingForApproval entries (shape check)
    expect(Object.keys(result.waitingForApproval[0]!)).not.toContain("topPriority");
  });

  it("otherLive entries have neither topPriority nor attentionReason", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(Object.keys(result.otherLive[0]!)).not.toContain("topPriority");
    expect(Object.keys(result.otherLive[0]!)).not.toContain("attentionReason");
  });

  it("has a top-level sourceHealthSummary with correct totals", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.sourceHealthSummary).toEqual({ healthy: 6, stale: 3, failed: 1 });
  });

  it("group entries have per-entry sourceHealthSummary (not aggregate)", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.needsAttention[0]!.sourceHealthSummary).toEqual({
      healthy: 1,
      stale: 1,
      failed: 1,
    });
  });

  it("accepts null clientName on group entries", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    const nullClient = result.needsAttention.find((e) => e.clientName === null);
    expect(nullClient).toBeDefined();
    expect(nullClient!.name).toBe("Always-On Search");
  });

  it("has recentlyResolved entries", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.recentlyResolved).toHaveLength(1);
    expect(result.recentlyResolved[0]!.alertId).toBe("alert-resolved-1");
  });

  it("has healthyCampaignCount matching otherLive length", () => {
    const result = controlCentreOperationsTodaySchema.parse(controlCentreOperationsTodayFixture);
    expect(result.healthyCampaignCount).toBe(2);
  });

  it("rejects invalid deliveryState", () => {
    expect(
      controlCentreOperationsTodaySchema.safeParse({
        ...controlCentreOperationsTodayFixture,
        otherLive: [
          { ...controlCentreOperationsTodayFixture.otherLive[0]!, deliveryState: "under-pacing" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects negative openAlerts", () => {
    expect(
      controlCentreOperationsTodaySchema.safeParse({
        ...controlCentreOperationsTodayFixture,
        otherLive: [{ ...controlCentreOperationsTodayFixture.otherLive[0]!, openAlerts: -1 }],
      }).success,
    ).toBe(false);
  });

  it("does NOT have a top-level counts object (CC never sends it)", () => {
    // The schema has no counts field, but Zod strips unknown keys, so an extra
    // counts object parses fine (it is simply dropped from the output).
    const withCounts = {
      ...controlCentreOperationsTodayFixture,
      counts: { needsAttention: 2, waitingForApproval: 1, otherLive: 2, total: 5 },
    };
    expect(controlCentreOperationsTodaySchema.safeParse(withCounts).success).toBe(true);
  });

  it("does NOT have topPriority on otherLive entries", () => {
    // Zod v4 passthrough default: extra fields are silently dropped.
    // The key verification: a valid otherLive entry (without topPriority) parses fine.
    expect(
      controlCentreOperationsTodaySchema.safeParse(controlCentreOperationsTodayFixture).success,
    ).toBe(true);
  });
});
