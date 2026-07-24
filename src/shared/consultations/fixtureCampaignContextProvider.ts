import type { CampaignContextForConsultation, CampaignContextProvider } from "./campaignContextProvider";

/**
 * Deterministic CampaignContextProvider used by tests (and by Phase 4 until the
 * real Control Centre adapter from Phase 3 is wired in). Given the same inputs
 * it always returns the same context. Tests may register per-campaign overrides
 * or force a retrieval failure / honour an AbortSignal.
 */
export interface FixtureContextOverride {
  context?: CampaignContextForConsultation;
  /** When set, getCampaignContext rejects with this error for the campaign. */
  failWith?: Error;
}

export class FixtureCampaignContextProvider implements CampaignContextProvider {
  private readonly overrides = new Map<string, FixtureContextOverride>();

  constructor(private readonly defaults?: Partial<CampaignContextForConsultation>) {}

  /** Register a fixed context (or a forced failure) for one campaign group. */
  setOverride(campaignGroupId: string, override: FixtureContextOverride): void {
    this.overrides.set(campaignGroupId, override);
  }

  async getCampaignContext(
    projectId: string,
    campaignGroupId: string,
    signal?: AbortSignal,
  ): Promise<CampaignContextForConsultation> {
    if (signal?.aborted) {
      throw new Error(`Campaign context retrieval aborted for ${campaignGroupId}`);
    }
    const override = this.overrides.get(campaignGroupId);
    if (override?.failWith) throw override.failWith;
    if (override?.context) return override.context;
    return this.buildDeterministic(projectId, campaignGroupId);
  }

  private buildDeterministic(
    projectId: string,
    campaignGroupId: string,
  ): CampaignContextForConsultation {
    const seed = deterministicSeed(`${projectId}:${campaignGroupId}`);
    const totalBudget = 40_000 + (seed % 6) * 10_000;
    const percentUsed = 35 + (seed % 40);
    const spentToDate = Math.round((totalBudget * percentUsed) / 100);
    const expectedPercentUsed = 50;
    const pacingStatus = percentUsed > expectedPercentUsed + 10 ? "ahead" : "on_track";
    return {
      campaignGroupId,
      campaignName: `Fixture Campaign ${seed % 100}`,
      clientName: "Fixture Client",
      status: "active",
      dates: { startDate: "2026-06-01", endDate: "2026-08-31" },
      budget: {
        totalBudget,
        spentToDate,
        remaining: totalBudget - spentToDate,
        percentUsed,
        expectedPercentUsed,
        pacingStatus,
      },
      kpis: [
        {
          id: `${campaignGroupId}:kpi:ctr`,
          metricKey: "ctr",
          targetType: "min",
          targetValue: 1.5,
          actualValue: 1.2 + (seed % 10) / 10,
          percentAchieved: 80 + (seed % 30),
          status: "on_track",
        },
        {
          id: `${campaignGroupId}:kpi:cpa`,
          metricKey: "cpa",
          targetType: "max",
          targetValue: 25,
          actualValue: 20 + (seed % 12),
          percentAchieved: 70 + (seed % 40),
          status: "at_risk",
        },
      ],
      channels: [
        {
          id: `${campaignGroupId}:ch:meta`,
          channelLabel: "Meta Ads",
          platform: "meta",
          plannedBudget: Math.round(totalBudget * 0.5),
          actualSpend: Math.round(spentToDate * 0.55),
          status: "active",
        },
        {
          id: `${campaignGroupId}:ch:google`,
          channelLabel: "Google Ads",
          platform: "google_ads",
          plannedBudget: Math.round(totalBudget * 0.5),
          actualSpend: Math.round(spentToDate * 0.45),
          status: "active",
        },
      ],
      sourceHealth: [
        {
          sourceAccountId: `${campaignGroupId}:acct:meta`,
          sourceName: "Meta connection",
          status: "healthy",
          lastSuccessfulSyncAt: "2026-07-21T06:00:00.000Z",
          reason: null,
        },
        {
          sourceAccountId: `${campaignGroupId}:acct:google`,
          sourceName: "Google connection",
          status: seed % 2 === 0 ? "stale" : "healthy",
          lastSuccessfulSyncAt: "2026-07-19T06:00:00.000Z",
          reason: seed % 2 === 0 ? "Token expired" : null,
        },
      ],
      openAlerts: [
        {
          id: `${campaignGroupId}:alert:pacing`,
          title: "Pacing ahead of plan",
          severity: "warning",
          priority: "P2",
          openedAt: "2026-07-20T09:00:00.000Z",
        },
      ],
      activeDecisions: [
        {
          id: `${campaignGroupId}:decision:1`,
          statement: "Hold Meta budget steady until Friday",
          reason: "Awaiting creative refresh",
          scopeType: "channel",
          startsAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-26T00:00:00.000Z",
          sourceType: "user",
          createdBy: "operator",
        },
      ],
      pendingProposals: [
        {
          id: `${campaignGroupId}:proposal:1`,
          title: "Shift 10% budget to Google",
          status: "pending",
          summary: "Rebalance toward the better-performing channel.",
          createdAt: "2026-07-20T10:00:00.000Z",
        },
      ],
      recentEvents: [
        {
          id: `${campaignGroupId}:event:1`,
          eventType: "budget_change",
          description: "Daily cap increased by 5%",
          occurredAt: "2026-07-19T14:00:00.000Z",
          severity: "info",
        },
      ],
      evidence: [
        {
          claimKey: "spend_vs_plan",
          statement: `Spend is ${percentUsed}% of plan vs ${expectedPercentUsed}% expected`,
          result: percentUsed,
          sources: [
            {
              sourceType: "ad_platform",
              label: "Meta Ads",
              capturedAt: "2026-07-21T06:00:00.000Z",
              freshnessStatus: "fresh",
            },
          ],
        },
      ],
      suggestedQuestions: [
        "Are we pacing to budget?",
        "Which channel is driving CPA?",
        "Any alerts I should act on today?",
      ],
      ...this.defaults,
    };
  }
}

/** Small stable string hash so fixture numbers are deterministic per input. */
function deterministicSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
