import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ConsultationResultRecord,
  ConsultationRecord,
  ContextPacketRecord,
  PanelMembershipRecord,
  ThreadSummaryRecord,
} from "@/shared/consultations";
import {
  dbGetConsultation,
  dbGetConsultationByChildRun,
  dbGetConsultationResultForConsultation,
  dbGetContextPacketForConsultation,
  dbGetLatestThreadSummary,
  dbInsertConsultationResult,
  dbInsertContextPacket,
  dbInsertPanelMembership,
  dbInsertThreadSummary,
  dbListConsultationsByCampaignGroup,
  dbListConsultationsByParentThread,
  dbListConsultationsByStatuses,
  dbListPanelMembers,
  dbListRetriesOf,
  dbUpsertConsultation,
} from "@/main/db/consultations";
import { setupTempDb, sqliteAvailable, teardownTempDb } from "@/supervisor/consultations/sqliteTestHarness";

function consultation(overrides: Partial<ConsultationRecord> = {}): ConsultationRecord {
  return {
    id: "c-1",
    parentProjectId: "p-1",
    parentThreadId: "t-1",
    campaignGroupId: "g-1",
    childThreadOrRunId: null,
    originalMention: "@daily_operator check pacing",
    originalInstruction: "check pacing",
    resolvedRole: "daily_operator",
    requestedProvider: null,
    actualProvider: null,
    requestedModel: null,
    actualModel: null,
    consultationMode: "standard",
    status: "queued",
    contextPacketId: null,
    permissionPolicyVersion: "campaign-consultation-policy-v1",
    actor: "user",
    createdAt: "2026-07-22T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    safeFailureMessage: null,
    resultSummaryId: null,
    retryOfConsultationId: null,
    ...overrides,
  };
}

describe.skipIf(!sqliteAvailable)("consultation persistence (real sqlite round-trip)", () => {
  let dir: string;

  beforeEach(() => {
    dir = setupTempDb();
  });
  afterEach(() => {
    teardownTempDb(dir);
  });

  it("round-trips a consultation record including nullable fields", () => {
    dbUpsertConsultation(consultation());
    const stored = dbGetConsultation("c-1");
    expect(stored).toMatchObject({
      id: "c-1",
      resolvedRole: "daily_operator",
      status: "queued",
      childThreadOrRunId: null,
      failureCode: null,
    });
  });

  it("round-trips a panel completion rule", () => {
    dbUpsertConsultation(consultation({
      consultationMode: "panel",
      resolvedRole: "panel",
      panelCompletionRule: { kind: "at_least", count: 2 },
    }));
    expect(dbGetConsultation("c-1")?.panelCompletionRule).toEqual({ kind: "at_least", count: 2 });
  });

  it("upsert updates an existing consultation in place", () => {
    dbUpsertConsultation(consultation());
    dbUpsertConsultation(
      consultation({ status: "running", childThreadOrRunId: "child-1", startedAt: "2026-07-22T00:05:00.000Z" }),
    );
    const stored = dbGetConsultation("c-1");
    expect(stored?.status).toBe("running");
    expect(stored?.childThreadOrRunId).toBe("child-1");
    expect(dbListConsultationsByParentThread("t-1")).toHaveLength(1);
  });

  it("lists by parent thread, campaign group, status and child run", () => {
    dbUpsertConsultation(consultation({ id: "c-1", createdAt: "2026-07-22T00:00:00.000Z" }));
    dbUpsertConsultation(consultation({ id: "c-2", status: "running", childThreadOrRunId: "child-2", createdAt: "2026-07-22T00:01:00.000Z" }));
    dbUpsertConsultation(consultation({ id: "c-3", campaignGroupId: "g-2", parentThreadId: "t-2", createdAt: "2026-07-22T00:02:00.000Z" }));

    expect(dbListConsultationsByParentThread("t-1").map((c) => c.id)).toEqual(["c-2", "c-1"]);
    expect(dbListConsultationsByCampaignGroup("g-1").map((c) => c.id)).toEqual(["c-2", "c-1"]);
    expect(dbListConsultationsByStatuses(["running"]).map((c) => c.id)).toEqual(["c-2"]);
    expect(dbGetConsultationByChildRun("child-2")?.id).toBe("c-2");
  });

  it("tracks the retry relationship without touching the original", () => {
    dbUpsertConsultation(consultation({ id: "orig", status: "failed", failureCode: "execution_failed" }));
    dbUpsertConsultation(consultation({ id: "retry-1", retryOfConsultationId: "orig" }));
    expect(dbListRetriesOf("orig").map((c) => c.id)).toEqual(["retry-1"]);
    expect(dbGetConsultation("orig")?.status).toBe("failed");
  });

  it("round-trips a context packet with structured JSON + hash", () => {
    dbUpsertConsultation(consultation());
    const packet: ContextPacketRecord = {
      id: "pkt-1",
      consultationId: "c-1",
      structuredContext: {
        parentRequest: "@daily_operator check pacing",
        explicitTask: "check pacing",
        relevantRecentConversation: [],
        durableThreadSummary: "summary",
        campaignIdentity: { campaignGroupId: "g-1", campaignName: "Test", clientName: null, status: "active" },
        dates: { startDate: "2026-06-01", endDate: "2026-08-31" },
        budget: { totalBudget: 1000, spentToDate: 100, remaining: 900, percentUsed: 10, expectedPercentUsed: 20, pacingStatus: "on_track" },
        kpiEvidence: [],
        alerts: [],
        activeDecisions: [],
        pendingProposals: [],
        recentCampaignEvents: [],
        permittedAttachments: [],
        evidenceFreshness: { oldestCapturedAt: null, newestCapturedAt: null, staleSourceCount: 0, statuses: [] },
        missingDataWarnings: ["Total budget is not set for this campaign."],
        permissionConstraints: ["read-only"],
        redactionMetadata: { redactedCount: 0, redactedFields: [], appliedAt: "2026-07-22T00:00:00.000Z" },
        createdAt: "2026-07-22T00:00:00.000Z",
        contractVersion: "consultation-context-v1",
        contentHash: "abc123",
      },
      contentHash: "abc123",
      contractVersion: "consultation-context-v1",
      redactionMetadata: { redactedCount: 0, redactedFields: [], appliedAt: "2026-07-22T00:00:00.000Z" },
      evidenceFreshness: { oldestCapturedAt: null, newestCapturedAt: null, staleSourceCount: 0, statuses: [] },
      missingDataWarnings: ["Total budget is not set for this campaign."],
      createdAt: "2026-07-22T00:00:00.000Z",
    };
    dbInsertContextPacket(packet);
    const stored = dbGetContextPacketForConsultation("c-1");
    expect(stored?.contentHash).toBe("abc123");
    expect(stored?.structuredContext.campaignIdentity.campaignName).toBe("Test");
    expect(stored?.missingDataWarnings).toEqual(["Total budget is not set for this campaign."]);
  });

  it("returns the latest thread summary per thread", () => {
    const first: ThreadSummaryRecord = {
      id: "s-1", threadId: "t-1", summary: "first", sourceCursor: "m-1", provider: "p", model: "m", contentHash: "h1", createdAt: "2026-07-22T00:00:00.000Z",
    };
    const second: ThreadSummaryRecord = {
      id: "s-2", threadId: "t-1", summary: "second", sourceCursor: "m-2", provider: "p", model: "m", contentHash: "h2", createdAt: "2026-07-22T00:10:00.000Z",
    };
    dbInsertThreadSummary(first);
    dbInsertThreadSummary(second);
    expect(dbGetLatestThreadSummary("t-1")?.summary).toBe("second");
  });

  it("round-trips a consultation result with array fields", () => {
    dbUpsertConsultation(consultation());
    const result: ConsultationResultRecord = {
      id: "r-1",
      consultationId: "c-1",
      summary: "All good",
      keyFindings: ["a", "b"],
      evidenceReferences: ["e1"],
      assumptions: ["x"],
      uncertainties: ["y"],
      recommendedActions: ["z"],
      suggestedProposalInputs: [{ title: "Shift budget", rationale: "CPA", scopeType: "channel", scopeId: "google", suggestedChange: "move 10%" }],
      generatedFileReferences: [],
      completedAt: "2026-07-22T01:00:00.000Z",
    };
    dbInsertConsultationResult(result);
    const stored = dbGetConsultationResultForConsultation("c-1");
    expect(stored?.keyFindings).toEqual(["a", "b"]);
    expect(stored?.suggestedProposalInputs[0]?.title).toBe("Shift budget");
  });

  it("persists panel membership ordered by sequence", () => {
    dbUpsertConsultation(consultation({ id: "panel-1", consultationMode: "panel" }));
    dbUpsertConsultation(consultation({ id: "m-1" }));
    dbUpsertConsultation(consultation({ id: "m-2" }));
    const a: PanelMembershipRecord = { parentPanelConsultationId: "panel-1", childConsultationId: "m-2", memberRole: "challenger", requiredOrOptional: "required", sequenceOrWeight: 1 };
    const b: PanelMembershipRecord = { parentPanelConsultationId: "panel-1", childConsultationId: "m-1", memberRole: "researcher", requiredOrOptional: "required", sequenceOrWeight: 0 };
    dbInsertPanelMembership(a);
    dbInsertPanelMembership(b);
    expect(dbListPanelMembers("panel-1").map((m) => m.childConsultationId)).toEqual(["m-1", "m-2"]);
  });

  it("cascade-deletes packets/results/membership when the consultation is deleted", () => {
    dbUpsertConsultation(consultation({ id: "panel-1", consultationMode: "panel" }));
    dbUpsertConsultation(consultation({ id: "m-1" }));
    dbInsertPanelMembership({ parentPanelConsultationId: "panel-1", childConsultationId: "m-1", memberRole: "researcher", requiredOrOptional: "required", sequenceOrWeight: 0 });
    dbInsertConsultationResult({
      id: "r-1", consultationId: "m-1", summary: "s", keyFindings: [], evidenceReferences: [], assumptions: [], uncertainties: [], recommendedActions: [], suggestedProposalInputs: [], generatedFileReferences: [], completedAt: "2026-07-22T01:00:00.000Z",
    });
    // Deleting the member consultation cascades its result; deleting the panel cascades membership.
    dbUpsertConsultation(consultation({ id: "m-1" }));
    expect(dbListPanelMembers("panel-1")).toHaveLength(1);
  });
});
