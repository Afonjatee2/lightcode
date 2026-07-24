import { describe, expect, it } from "vitest";
import { controlCentreOperationsTodayFixture } from "@/shared/contracts/campaign/fixtures/controlCentreOperationsToday.fixture";
import { mapOperationsToday } from "@/renderer/adapters/mapOperationsToday";
import {
  classifyNeedsAttentionException,
  classifyWaitingForApprovalException,
  filterNewExceptions,
  formatHealthNote,
  generateMorningBrief,
} from "./briefGenerator";

describe("briefGenerator", () => {
  it("generates a morning brief with correct counts, health note, and exceptions", () => {
    const mapped = mapOperationsToday(controlCentreOperationsTodayFixture);
    const brief = generateMorningBrief(mapped);

    expect(brief.generatedAt).toBe("2026-11-20T18:00:00.000Z");
    expect(brief.counts).toEqual({
      needsAttention: 2,
      waitingForApproval: 1,
      otherLive: 2,
      healthy: 2,
      total: 5,
    });
    expect(brief.healthNote).toBe("6 healthy, 3 stale, 1 failed");
    expect(brief.topNeedsAttention).toHaveLength(2);
    expect(brief.topWaitingForApproval).toHaveLength(1);

    // Health note helper
    expect(formatHealthNote({ healthy: 5, stale: 0, failed: 0 })).toBe("5 healthy");

    // Exception checks:
    // P1 alert item is an exception
    expect(
      brief.exceptions.some(
        (ex) =>
          ex.campaignName === "Q4 Brand Refresh" && ex.exceptionType === "critical_high_alert",
      ),
    ).toBe(true);
    // Waiting for approval item is an exception
    expect(
      brief.exceptions.some(
        (ex) =>
          ex.campaignName === "Holiday Gifting Campaign" &&
          ex.exceptionType === "proposal_awaiting",
      ),
    ).toBe(true);
    expect(brief.hasExceptions).toBe(true);
  });

  it("respects maxItemsPerSection option", () => {
    const mapped = mapOperationsToday(controlCentreOperationsTodayFixture);
    const brief = generateMorningBrief(mapped, { maxItemsPerSection: 1 });

    expect(brief.topNeedsAttention).toHaveLength(1);
    expect(brief.topWaitingForApproval).toHaveLength(1);
  });

  it("classifies exceptions correctly for needsAttention items", () => {
    expect(classifyNeedsAttentionException("P1", "Some critical alert")).toEqual({
      isException: true,
      exceptionType: "critical_high_alert",
    });
    expect(classifyNeedsAttentionException("P2", "High alert")).toEqual({
      isException: true,
      exceptionType: "critical_high_alert",
    });
    expect(classifyNeedsAttentionException("P3", "Campaign did not spend budget today")).toEqual({
      isException: true,
      exceptionType: "no_spend",
    });
    expect(classifyNeedsAttentionException("P3", "New ad rejected on Google Ads")).toEqual({
      isException: true,
      exceptionType: "rejected_ad",
    });
    expect(classifyNeedsAttentionException("P4", "Failed action during sync")).toEqual({
      isException: true,
      exceptionType: "failed_action",
    });
    expect(classifyNeedsAttentionException("P3", "1 open alert, highest priority P3")).toEqual({
      isException: false,
    });
  });

  it("classifies exceptions correctly for waitingForApproval items", () => {
    expect(classifyWaitingForApprovalException(2)).toEqual({
      isException: true,
      exceptionType: "proposal_awaiting",
    });
    expect(classifyWaitingForApprovalException(0)).toEqual({
      isException: false,
    });
  });

  it("returns no exceptions for an all-clear payload", () => {
    const allClearMapped = mapOperationsToday({
      generatedAt: "2026-11-20T18:00:00.000Z",
      needsAttention: [],
      waitingForApproval: [],
      otherLive: [
        {
          campaignGroupId: "d4e5f6a7-b8c9-0123-defa-234567890123",
          name: "B2B Lead Gen",
          clientName: "Orion Technical Solutions",
          status: "active",
          deliveryState: "delivering",
          openAlerts: 0,
          pendingProposals: 0,
          sourceHealthSummary: { healthy: 2, stale: 0, failed: 0 },
          lastDataFreshnessAt: "2026-11-20T10:30:00.000Z",
        },
      ],
      healthyCampaignCount: 1,
      sourceHealthSummary: { healthy: 2, stale: 0, failed: 0 },
      recentlyResolved: [],
    });

    const brief = generateMorningBrief(allClearMapped);
    expect(brief.exceptions).toHaveLength(0);
    expect(brief.hasExceptions).toBe(false);
    expect(brief.healthNote).toBe("2 healthy");
  });

  it("de-duplicates exceptions properly", () => {
    const mapped = mapOperationsToday(controlCentreOperationsTodayFixture);
    const brief = generateMorningBrief(mapped);
    expect(brief.exceptions.length).toBeGreaterThan(0);

    const firstExceptionId = brief.exceptions[0]!.id;
    const filtered = filterNewExceptions(brief.exceptions, [firstExceptionId]);

    expect(filtered).toHaveLength(brief.exceptions.length - 1);
    expect(filtered.some((e) => e.id === firstExceptionId)).toBe(false);
  });
});
