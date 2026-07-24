import { describe, expect, it } from "vitest";
import { mapOperationsToday } from "./mapOperationsToday";
import { controlCentreOperationsTodayFixture } from "@/shared/contracts/campaign/fixtures/controlCentreOperationsToday.fixture";

describe("mapOperationsToday", () => {
  it("derives counts from array lengths", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.counts.needsAttention).toBe(2);
    expect(vm.counts.waitingForApproval).toBe(1);
    expect(vm.counts.otherLive).toBe(2);
    expect(vm.counts.total).toBe(5);
  });

  it("maps group fields to UI-friendly names", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    const first = vm.needsAttention[0]!;
    expect(first.campaignGroupId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(first.clientName).toBe("Bright Horizon Group");
    expect(first.campaignName).toBe("Q4 Brand Refresh");
    expect(first.lifecycleStatus).toBe("active");
    expect(first.openAlertCount).toBe(3);
    expect(first.pendingProposalCount).toBe(2);
  });

  it("maps null clientName to '—' fallback", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    const nullClient = vm.needsAttention.find(
      (e) => e.campaignGroupId === "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    );
    expect(nullClient!.clientName).toBe("—");
  });

  it("maps deliveryState through unchanged", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.needsAttention[0]!.deliveryState).toBe("delivering");
    expect(vm.otherLive[1]!.deliveryState).toBe("unavailable");
  });

  it("formats sourceHealthSummary as a readable string", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.needsAttention[0]!.sourceHealthSummary).toBe("1 healthy, 1 stale, 1 failed");
    expect(vm.otherLive[0]!.sourceHealthSummary).toBe("2 healthy");
  });

  it('shows "—" for empty sourceHealthSummary', () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    const empty = vm.otherLive.find(
      (e) => e.campaignGroupId === "e5f6a7b8-c9d0-1234-efab-345678901234",
    );
    expect(empty!.sourceHealthSummary).toBe("—");
  });

  it("needsAttention entries get attentionReason from wire", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.needsAttention[0]!.attentionReason).toContain("P1");
  });

  it("waitingForApproval entries get attentionReason from wire", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.waitingForApproval[0]!.attentionReason).toContain("awaiting approval");
  });

  it("otherLive entries have undefined attentionReason", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.otherLive[0]!.attentionReason).toBeUndefined();
  });

  it("preserves generatedAt", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.generatedAt).toBe("2026-11-20T18:00:00.000Z");
  });

  it("preserves lastSyncedAt value", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.needsAttention[0]!.lastSyncedAt).toBe("2026-11-20T06:05:00.000Z");
  });

  it("preserves null lastDataFreshnessAt (maps to lastSyncedAt)", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    const nullSync = vm.otherLive.find(
      (e) => e.campaignGroupId === "e5f6a7b8-c9d0-1234-efab-345678901234",
    );
    expect(nullSync!.lastSyncedAt).toBeNull();
  });

  it("maps topPriority for needsAttention entries", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.needsAttention[0]!.topPriority).toBe("P1");
    expect(vm.needsAttention[1]!.topPriority).toBe("P3");
    expect(vm.waitingForApproval[0]!.topPriority).toBeUndefined();
  });

  it("maps top-level healthyCampaignCount", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.healthyCampaignCount).toBe(2);
  });

  it("maps top-level sourceHealthSummary", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.sourceHealthSummary).toEqual({ healthy: 6, stale: 3, failed: 1 });
  });

  it("maps recentlyResolved alerts list", () => {
    const vm = mapOperationsToday(controlCentreOperationsTodayFixture);
    expect(vm.recentlyResolved).toHaveLength(1);
    expect(vm.recentlyResolved[0]!.campaignGroupId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(vm.recentlyResolved[0]!.name).toBe("Q4 Brand Refresh");
    expect(vm.recentlyResolved[0]!.alertId).toBe("alert-resolved-1");
    expect(vm.recentlyResolved[0]!.resolvedAt).toBe("2026-11-19T14:30:00.000Z");
  });
});
