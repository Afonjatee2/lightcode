import type { ControlCentreOperationsToday } from "../controlCentreOperationsToday";

/**
 * Representative fixture for `get_operations_today` covering all three buckets,
 * each with realistic sourceHealthSummary values, P1..P4 priorities on
 * needsAttention, campaign with null clientName, a "stale" deliveryState group,
 * recentlyResolved alerts, and a top-level sourceHealthSummary.
 *
 * PROVENANCE: Shape mirrors Control Centre's Phase 3 Typebox wire schema
 * (apps/api/src/routes/phase3-schemas.ts: OperationsTodayViewSchema) and
 * the builder service (apps/api/src/services/operations.ts) at base SHA
 * 3df2d0d97c4dace17b68960d4b27470b726f051d.
 */
export const controlCentreOperationsTodayFixture: ControlCentreOperationsToday = {
  generatedAt: "2026-11-20T18:00:00.000Z",
  needsAttention: [
    {
      campaignGroupId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "Q4 Brand Refresh",
      clientName: "Bright Horizon Group",
      status: "active",
      deliveryState: "delivering",
      openAlerts: 3,
      pendingProposals: 2,
      sourceHealthSummary: { healthy: 1, stale: 1, failed: 1 },
      lastDataFreshnessAt: "2026-11-20T06:05:00.000Z",
      topPriority: "P1",
      attentionReason: "3 open alerts, highest priority P1",
    },
    {
      campaignGroupId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      name: "Always-On Search",
      clientName: null, // deliberately null
      status: "active",
      deliveryState: "stale",
      openAlerts: 1,
      pendingProposals: 0,
      sourceHealthSummary: { healthy: 0, stale: 2, failed: 0 },
      lastDataFreshnessAt: null, // deliberately null
      topPriority: "P3",
      attentionReason: "1 open alert, highest priority P3",
    },
  ],
  waitingForApproval: [
    {
      campaignGroupId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
      name: "Holiday Gifting Campaign",
      clientName: "Maple & Pine Co.",
      status: "active",
      deliveryState: "delivering",
      openAlerts: 0,
      pendingProposals: 3,
      sourceHealthSummary: { healthy: 3, stale: 0, failed: 0 },
      lastDataFreshnessAt: "2026-11-20T12:00:00.000Z",
      attentionReason: "3 proposals awaiting approval",
    },
  ],
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
    {
      campaignGroupId: "e5f6a7b8-c9d0-1234-efab-345678901234",
      name: "Q1 Teaser Campaign",
      clientName: "Bright Horizon Group",
      status: "active",
      deliveryState: "unavailable",
      openAlerts: 0,
      pendingProposals: 0,
      sourceHealthSummary: { healthy: 0, stale: 0, failed: 0 },
      lastDataFreshnessAt: null,
    },
  ],
  healthyCampaignCount: 2,
  sourceHealthSummary: { healthy: 6, stale: 3, failed: 1 },
  recentlyResolved: [
    {
      campaignGroupId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "Q4 Brand Refresh",
      alertId: "alert-resolved-1",
      resolvedAt: "2026-11-19T14:30:00.000Z",
    },
  ],
};
