import { describe, expect, it } from "vitest";
import {
  PoracodeCampaignContextProvider,
  ControlCentreUnavailableError,
} from "./poracodeCampaignContextProvider";
import type { ControlCentreGateway, ControlCentreToolOutcome } from "./controlCentreGateway";

function validResponse() {
  return {
    identity: {
      id: "cg-1",
      name: "Q3 Brand Launch",
      clientName: "Acme Corp",
      jobNumber: null,
      status: "active",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    },
    budget: {
      totalBudget: 100_000,
      spentToDate: 45_000,
      remaining: 55_000,
      percentUsed: 45,
      expectedPercentUsed: 50,
      pacingStatus: "on_track",
    },
    kpiTargets: [
      { id: "kpi-1", metricKey: "ctr", targetType: "min", targetValue: 1.5, actualValue: 1.3, percentAchieved: 86, status: "on_track" },
    ],
    channelExecutions: [
      { id: "ch-1", channelLabel: "Meta Ads", platform: "meta", plannedBudget: 50_000, actualSpend: 25_000, status: "active" },
    ],
    sourceHealth: [{ sourceAccountId: "sa-1", sourceName: "Meta", status: "healthy", lastSuccessfulSyncAt: "2026-07-21T06:00:00.000Z", reason: null }],
    openAlerts: [{ id: "al-1", title: "Pacing ahead", severity: "warning", priority: "P2", openedAt: "2026-07-20T09:00:00.000Z" }],
    activeDecisions: [{ id: "d-1", title: "Hold Meta budget", decisionType: "channel", createdAt: "2026-07-18T00:00:00.000Z", status: "active" }],
    pendingProposals: [{ id: "p-1", title: "Shift 10%", status: "pending", riskLevel: null, createdAt: "2026-07-20T10:00:00.000Z" }],
    recentEvents: [{ id: "e-1", eventType: "budget_change", title: "Daily cap increased", description: null, severity: "info", createdAt: "2026-07-19T14:00:00.000Z" }],
    evidence: [{
      claimKey: "spend_vs_plan",
      statement: "45% vs 50%",
      calculation: { expression: "spent / budget * 100", inputs: { spent: 45_000, budget: 100_000 }, result: 45 },
      sources: [{ sourceType: "ad_platform", sourceId: "sa-1", label: "Meta Ads", capturedAt: "2026-07-21T06:00:00.000Z", freshnessStatus: "fresh" }],
    }],
    suggestedQuestions: ["Are we pacing to budget?"],
  };
}

function gatewayReturning(content: unknown): ControlCentreGateway {
  return {
    async callTool(): Promise<ControlCentreToolOutcome> {
      return { status: "ok", content };
    },
  };
}

function gatewayFailing(message: string): ControlCentreGateway {
  return {
    async callTool(): Promise<ControlCentreToolOutcome> {
      return { status: "unavailable", message };
    },
  };
}

describe("PoracodeCampaignContextProvider strict validation", () => {
  it("accepts a valid exact Control Centre response", async () => {
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(validResponse()));
    const ctx = await provider.getCampaignContext("p-1", "cg-1");
    expect(ctx.campaignName).toBe("Q3 Brand Launch");
    expect(ctx.budget.spentToDate).toBe(45_000);
    expect(ctx.sourceHealth[0]?.status).toBe("healthy");
  });

  it("throws context_retrieval_failed when the top-level response is not an object", async () => {
    const provider = new PoracodeCampaignContextProvider(gatewayReturning("not an object"));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed when identity is missing", async () => {
    const bad = { ...validResponse() };
    delete (bad as Record<string, unknown>).identity;
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed when campaign name is missing", async () => {
    const bad = validResponse();
    bad.identity.name = "";
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed when spent-to-date is missing", async () => {
    const bad = validResponse();
    delete (bad.budget as Record<string, unknown>).spentToDate;
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed when spent-to-date is NaN", async () => {
    const bad = validResponse();
    (bad.budget as Record<string, unknown>).spentToDate = NaN;
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed when spent-to-date is a string", async () => {
    const bad = validResponse();
    (bad.budget as Record<string, unknown>).spentToDate = "forty five";
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed for invalid source-health enum", async () => {
    const bad = validResponse();
    bad.sourceHealth[0]!.status = "broken";
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed when budget is not an object", async () => {
    const bad = { ...validResponse(), budget: "not-an-object" };
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed when kpiTargets is not an array", async () => {
    const bad = { ...validResponse(), kpiTargets: { a: 1 } };
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  const requiredArrays = [
    "kpiTargets",
    "channelExecutions",
    "sourceHealth",
    "openAlerts",
    "activeDecisions",
    "pendingProposals",
    "recentEvents",
    "evidence",
    "suggestedQuestions",
  ] as const;

  it.each(requiredArrays)("rejects a missing required array: %s", async (fieldName) => {
    const bad = validResponse() as unknown as Record<string, unknown>;
    delete bad[fieldName];
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it.each(requiredArrays)("rejects a non-array required field: %s", async (fieldName) => {
    const bad = validResponse() as unknown as Record<string, unknown>;
    bad[fieldName] = { invalid: true };
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it.each(requiredArrays)("accepts a valid empty required array: %s", async (fieldName) => {
    const good = validResponse() as unknown as Record<string, unknown>;
    good[fieldName] = [];
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(good));
    await expect(provider.getCampaignContext("p-1", "cg-1")).resolves.toBeDefined();
  });

  it("rejects missing nested evidence sources", async () => {
    const bad = validResponse();
    delete (bad.evidence[0] as unknown as Record<string, unknown>).sources;
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("tolerates null clientName", async () => {
    const good = validResponse();
    (good.identity as Record<string, unknown>).clientName = null;
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(good));
    const ctx = await provider.getCampaignContext("p-1", "cg-1");
    expect(ctx.clientName).toBeNull();
  });

  it("throws context_retrieval_failed when CC gateway returns an error", async () => {
    const provider = new PoracodeCampaignContextProvider(gatewayFailing("server error"));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed for missing kpi.targetValue", async () => {
    const bad = validResponse();
    delete (bad.kpiTargets[0] as Record<string, unknown>).targetValue;
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });

  it("throws context_retrieval_failed for missing channel.actualSpend", async () => {
    const bad = validResponse();
    delete (bad.channelExecutions[0] as Record<string, unknown>).actualSpend;
    const provider = new PoracodeCampaignContextProvider(gatewayReturning(bad));
    await expect(provider.getCampaignContext("p-1", "cg-1")).rejects.toThrow(ControlCentreUnavailableError);
  });
});
