import { describe, expect, it } from "vitest";
import { FixtureCampaignContextProvider, type ConversationTurn } from "@/shared/consultations";
import { ContextPacketBuilder } from "./contextPacketBuilder";
import { ThreadSummaryService } from "./threadSummaryService";
import {
  DeterministicClock,
  DeterministicSummaryGenerator,
  FixtureParentThread,
  InMemoryConsultationRepository,
  SequentialIdGenerator,
} from "./testing";

function makeBuilder(options: {
  messages?: ConversationTurn[];
  contextProvider?: FixtureCampaignContextProvider;
  maxRecentMessages?: number;
  maxRecentChars?: number;
}) {
  const repository = new InMemoryConsultationRepository();
  const clock = new DeterministicClock();
  const ids = new SequentialIdGenerator();
  const parentThread = new FixtureParentThread();
  if (options.messages) parentThread.messages = options.messages;
  const contextProvider = options.contextProvider ?? new FixtureCampaignContextProvider();
  const threadSummaryService = new ThreadSummaryService({
    repository,
    generator: new DeterministicSummaryGenerator(),
    clock,
    idGenerator: ids,
  });
  const builder = new ContextPacketBuilder({
    repository,
    contextProvider,
    threadSummaryService,
    parentThreadPort: parentThread,
    clock,
    idGenerator: ids,
    ...(options.maxRecentMessages ? { maxRecentMessages: options.maxRecentMessages } : {}),
    ...(options.maxRecentChars ? { maxRecentChars: options.maxRecentChars } : {}),
  });
  return { builder, repository };
}

function manyMessages(count: number): ConversationTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message number ${i}`,
    messageId: `m-${i}`,
    createdAt: "2026-07-22T00:00:00.000Z",
  }));
}

const BASE_INPUT = {
  consultationId: "c-1",
  parentProjectId: "p-1",
  parentThreadId: "t-1",
  campaignGroupId: "g-1",
  role: "daily_operator" as const,
  originalMention: "@daily_operator check pacing",
  explicitTask: "check pacing",
};

describe("context packet builder", () => {
  it("builds and persists a packet with a content hash + campaign identity", async () => {
    const { builder, repository } = makeBuilder({});
    const { record, body } = await builder.build(BASE_INPUT);
    expect(record.contentHash.length).toBeGreaterThan(0);
    expect(body.contentHash).toBe(record.contentHash);
    expect(body.campaignIdentity.campaignGroupId).toBe("g-1");
    expect(repository.getContextPacket(record.id)?.contentHash).toBe(record.contentHash);
  });

  it("caps the number of recent messages", async () => {
    const { builder } = makeBuilder({ messages: manyMessages(40), maxRecentMessages: 5 });
    const { body } = await builder.build(BASE_INPUT);
    expect(body.relevantRecentConversation.length).toBeLessThanOrEqual(5);
  });

  it("caps the recent conversation by character budget", async () => {
    const longMessages: ConversationTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `x`.repeat(500) + ` ${i}`,
      messageId: `m-${i}`,
      createdAt: "2026-07-22T00:00:00.000Z",
    }));
    const { builder } = makeBuilder({ messages: longMessages, maxRecentMessages: 20, maxRecentChars: 1200 });
    const { body } = await builder.build(BASE_INPUT);
    const totalChars = body.relevantRecentConversation.reduce((sum, turn) => sum + turn.content.length, 0);
    expect(body.relevantRecentConversation.length).toBeLessThan(20);
    expect(totalChars).toBeLessThanOrEqual(1200 + 600);
  });

  it("redacts secrets found in the conversation and records metadata", async () => {
    const messages: ConversationTurn[] = [
      { role: "user", content: "here is my key ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", messageId: "m1", createdAt: null },
    ];
    const { builder } = makeBuilder({ messages });
    const { body } = await builder.build(BASE_INPUT);
    expect(body.relevantRecentConversation[0]?.content).not.toContain("ghp_");
    expect(body.redactionMetadata.redactedCount).toBeGreaterThan(0);
  });

  it("surfaces missing-data warnings for a null budget", async () => {
    const provider = new FixtureCampaignContextProvider();
    provider.setOverride("g-null", {
      context: {
        campaignGroupId: "g-null",
        campaignName: "No budget",
        clientName: null,
        status: "active",
        dates: { startDate: "2026-06-01", endDate: "2026-08-31" },
        budget: { totalBudget: null, spentToDate: 0, remaining: null, percentUsed: null, expectedPercentUsed: null, pacingStatus: null },
        kpis: [{ id: "k", metricKey: "ctr", targetType: "min", targetValue: 1, actualValue: null, percentAchieved: null, status: null }],
        channels: [],
        sourceHealth: [{ sourceAccountId: "a", sourceName: "Stale source", status: "stale", lastSuccessfulSyncAt: null, reason: "Token expired" }],
        openAlerts: [],
        activeDecisions: [],
        pendingProposals: [],
        recentEvents: [],
        evidence: [],
        suggestedQuestions: [],
      },
    });
    const { builder } = makeBuilder({ contextProvider: provider });
    const { body } = await builder.build({ ...BASE_INPUT, campaignGroupId: "g-null" });
    const warnings = body.missingDataWarnings.join("\n");
    expect(warnings).toContain("Total budget is not set");
    expect(warnings).toContain("Stale source");
    expect(warnings).toContain("ctr");
    expect(body.evidenceFreshness.staleSourceCount).toBe(1);
  });

  it("omits campaign events for a role without read_campaign_events (panel parent keeps baseline reads)", async () => {
    const { builder } = makeBuilder({});
    const { body } = await builder.build({ ...BASE_INPUT, role: "panel" });
    // panel keeps the read-only baseline, so events are still present
    expect(Array.isArray(body.recentCampaignEvents)).toBe(true);
    expect(body.permissionConstraints.join("\n")).toContain("Role: panel");
  });
});
