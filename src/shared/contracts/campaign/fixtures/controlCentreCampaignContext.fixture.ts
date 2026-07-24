import type { ControlCentreCampaignContext } from "../controlCentreCampaignContext";

/**
 * Representative fixture for `get_campaign_context` — every value is realistic
 * and covers: null client/job, null budget, healthy+stale+failed sourceHealth,
 * P1..P4 alerts, evidence WITH and WITHOUT a calculation, an event with
 * description=null, proposals with null riskLevel, suggested questions.
 *
 * PROVENANCE: Shape mirrors Control Centre's Phase 3 Typebox wire schema
 * (apps/api/src/routes/phase3-schemas.ts: CampaignContextResponseSchema) and
 * its domain types (packages/shared/src/domain/campaign-context.ts) at base SHA
 * 3df2d0d97c4dace17b68960d4b27470b726f051d.
 */
export const controlCentreCampaignContextFixture: ControlCentreCampaignContext = {
  identity: {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    name: "Q4 Brand Refresh",
    clientName: "Bright Horizon Group",
    jobNumber: "BHG-2026-Q4-01",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    status: "live",
  },
  budget: {
    totalBudget: 150_000,
    spentToDate: 68_250.5,
    remaining: 81_749.5,
    percentUsed: 0.455,
    expectedPercentUsed: 0.42,
    pacingStatus: "AHEAD",
  },
  kpiTargets: [
    {
      id: "kpi-1",
      metricKey: "ctr",
      targetType: "min",
      targetValue: 2.0,
      actualValue: 1.85,
      percentAchieved: 0.925,
      status: "on_track",
    },
    {
      id: "kpi-2",
      metricKey: "cpa",
      targetType: "max",
      targetValue: 35.0,
      actualValue: 42.3,
      percentAchieved: 0.827,
      status: "off_track",
    },
    {
      id: "kpi-3",
      metricKey: "reach",
      targetType: "min",
      targetValue: 500_000,
      actualValue: null, // not yet reported
      percentAchieved: null,
      status: null,
    },
  ],
  openAlerts: [
    {
      id: "alert-1",
      title: "Overspend on Meta channel",
      severity: "critical",
      priority: "P1",
      openedAt: "2026-11-15T08:30:00.000Z",
    },
    {
      id: "alert-2",
      title: "LinkedIn CPA trending up",
      severity: "warning",
      priority: "P2",
      openedAt: "2026-11-18T14:00:00.000Z",
    },
    {
      id: "alert-3",
      title: "GA4 connector delayed sync",
      severity: "info",
      priority: "P4",
      openedAt: "2026-11-20T09:15:00.000Z",
    },
  ],
  channelExecutions: [
    {
      id: "ch-1",
      channelLabel: "Meta Ads",
      platform: "facebook",
      plannedBudget: 60_000,
      actualSpend: 42_100,
      status: "active",
    },
    {
      id: "ch-2",
      channelLabel: "LinkedIn Sponsored",
      platform: "linkedin",
      plannedBudget: 40_000,
      actualSpend: 18_650.5,
      status: "active",
    },
    {
      id: "ch-3",
      channelLabel: "Programmatic Display",
      platform: "dv360",
      plannedBudget: 50_000,
      actualSpend: 7_500,
      status: "paused",
    },
  ],
  sourceHealth: [
    {
      sourceAccountId: "src-1",
      sourceName: "Meta Business Account",
      status: "healthy",
      lastSuccessfulSyncAt: "2026-11-20T06:05:00.000Z",
      reason: null,
    },
    {
      sourceAccountId: "src-2",
      sourceName: "LinkedIn Campaign Manager",
      status: "stale",
      lastSuccessfulSyncAt: "2026-11-17T12:00:00.000Z",
      reason: "Rate-limited by platform API",
    },
    {
      sourceAccountId: "src-3",
      sourceName: "DV360 Connector",
      status: "failed",
      lastSuccessfulSyncAt: null,
      reason: "OAuth token expired",
    },
  ],
  activeDecisions: [
    {
      id: "dec-1",
      title: "Shift budget from Meta to LinkedIn for December",
      decisionType: "budget_reallocation",
      status: "draft",
      createdAt: "2026-11-19T10:00:00.000Z",
    },
  ],
  recentEvents: [
    {
      id: "evt-1",
      eventType: "plan_published",
      title: "Q4 Brand Refresh plan published",
      description: "Media plan approved by client and pushed to channels.",
      severity: "info",
      createdAt: "2026-10-01T00:01:00.000Z",
    },
    {
      id: "evt-2",
      eventType: "alert_opened",
      title: "Overspend on Meta channel",
      description: null, // deliberately null
      severity: "critical",
      createdAt: "2026-11-15T08:30:00.000Z",
    },
    {
      id: "evt-3",
      eventType: "operator_note",
      title: "Client requested spend review",
      description:
        "Client wants a mid-month breakdown of Meta spend by ad set before approving December reallocation.",
      severity: "info",
      createdAt: "2026-11-18T16:45:00.000Z",
    },
  ],
  pendingProposals: [
    {
      id: "prop-1",
      title: "December budget reallocation plan",
      status: "pending_review",
      riskLevel: "low",
      createdAt: "2026-11-20T11:00:00.000Z",
    },
    {
      id: "prop-2",
      title: "Add TikTok as Q1 test channel",
      status: "draft",
      riskLevel: null, // deliberately null
      createdAt: "2026-11-19T09:00:00.000Z",
    },
  ],
  evidence: [
    {
      claimKey: "spend_vs_budget",
      statement:
        "Total channel spend is 45.5% of budget against 42.0% of elapsed campaign days, pacing ahead.",
      calculation: {
        expression: "spentToDate / totalBudget",
        inputs: {
          spentToDate: 68_250.5,
          totalBudget: 150_000,
        },
        result: 0.455,
      },
      sources: [
        {
          sourceType: "campaign_group",
          sourceId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          label: "Campaign group budget row",
          capturedAt: "2026-10-01T00:00:00.000Z",
          freshnessStatus: "fresh",
        },
        {
          sourceType: "metric_snapshot",
          sourceId: "ch-1-snap",
          label: "Meta Ads latest snapshot",
          capturedAt: "2026-11-20T06:05:00.000Z",
          freshnessStatus: "fresh",
        },
      ],
    },
    {
      claimKey: "source_health",
      statement: "1 of 3 source accounts is unhealthy (LinkedIn stale, DV360 failed).",
      calculation: null, // no calculation — qualitative claim
      sources: [
        {
          sourceType: "source_account",
          sourceId: "src-2",
          label: "LinkedIn Campaign Manager status",
          capturedAt: "2026-11-17T12:00:00.000Z",
          freshnessStatus: "stale",
        },
        {
          sourceType: "source_account",
          sourceId: "src-3",
          label: "DV360 Connector status",
          capturedAt: null,
          freshnessStatus: "stale",
        },
      ],
    },
  ],
  suggestedQuestions: [
    "Why is Q4 Brand Refresh overspending, and where can we pull back?",
    "What are the 3 open alerts on Q4 Brand Refresh?",
    "Why is cpa off track?",
    "Summarise how Q4 Brand Refresh is performing this week.",
  ],
};

/**
 * Minimal fixture: null client/job, null budget, empty collections, no alerts.
 * Tests that the schema accepts a campaign with very little data yet.
 */
export const controlCentreCampaignContextFixtureMinimal: ControlCentreCampaignContext = {
  identity: {
    id: "m1n2o3p4-q5r6-7890-abcd-ef1234567890",
    name: "Silent Launch",
    clientName: null,
    jobNumber: null,
    startDate: "2026-11-01",
    endDate: "2026-12-15",
    status: "live",
  },
  budget: {
    totalBudget: null,
    spentToDate: 0,
    remaining: null,
    percentUsed: null,
    expectedPercentUsed: null,
    pacingStatus: null,
  },
  kpiTargets: [],
  openAlerts: [],
  channelExecutions: [],
  sourceHealth: [],
  activeDecisions: [],
  recentEvents: [],
  pendingProposals: [],
  evidence: [],
  suggestedQuestions: [],
};
