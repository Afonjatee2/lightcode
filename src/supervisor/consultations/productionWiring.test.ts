import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupervisorEvent } from "@/shared/ipc/events";
import type { RuntimeEvent } from "@/shared/contracts";
import {
  FixtureCampaignContextProvider,
  buildResultAttachment,
  type ConsultationResultRecord,
} from "@/shared/consultations";
import { dbApplyThreadRuntimeEvents, dbGetThreadRuntimeItems } from "@/main/db/runtimeItems";
import { dbUpsertProject, dbUpsertThread } from "@/main/db/projectsThreads";
import { ContextPacketBuilder } from "./contextPacketBuilder";
import { loadParentThreadMessages, createParentThreadLoader } from "./parentThreadLoader";
import { consultationResultItemId, createResultAttacher } from "./resultAttachment";
import { SqliteConsultationRepository } from "./sqliteRepository";
import { setupTempDb, sqliteAvailable, teardownTempDb } from "./sqliteTestHarness";
import { ConsultationSubmissionHandler } from "./submissionHandler";
import { LoaderParentThreadPort } from "./supervisorAdapters";
import { ThreadSummaryService } from "./threadSummaryService";
import {
  DeterministicClock,
  DeterministicSummaryGenerator,
  SequentialIdGenerator,
  createTestCoordinator,
  waitForTerminal,
} from "./testing";

/**
 * Production-path integration tests (Part 11). These exercise the REAL wiring —
 * the submission handler, the durable SQLite repository, the real parent-thread
 * loader against the actual runtime-item store, the idempotent result attachment
 * and restart reconciliation — rather than isolated units. Skips itself only if
 * no usable better-sqlite3 binding can be built (the vitest global setup prepares
 * one, so this runs on a normal checkout).
 */

const PROJECT_ID = "project-1";
const THREAD_ID = "thread-1";

function seedProjectAndThread(campaignGroupId?: string): void {
  dbUpsertProject(
    {
      id: PROJECT_ID,
      name: "Campaign project",
      location: { kind: "posix", path: "/tmp/campaign-project" },
      ...(campaignGroupId ? { campaignGroupId } : {}),
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    0,
  );
  dbUpsertThread(
    {
      id: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Campaign thread",
      agentKind: "claude",
      config: { model: "sonnet" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: false,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    0,
  );
}

function seedParentMessages(threadId: string): void {
  const events: RuntimeEvent[] = [
    {
      type: "item.started",
      threadId,
      itemId: "msg-user-1",
      itemType: "user_message",
      payload: { content: [{ kind: "text", text: "How is the campaign pacing?" }] },
    },
    { type: "item.completed", threadId, itemId: "msg-user-1" },
    {
      type: "item.started",
      threadId,
      itemId: "msg-asst-1",
      itemType: "assistant_message",
      payload: { content: [{ kind: "text", text: "Spend is tracking ahead of plan." }] },
    },
    { type: "item.completed", threadId, itemId: "msg-asst-1" },
    {
      type: "item.started",
      threadId,
      itemId: "msg-reasoning-1",
      itemType: "reasoning",
      payload: { content: [{ kind: "text", text: "hidden chain-of-thought that must not leak" }] },
    },
    { type: "item.completed", threadId, itemId: "msg-reasoning-1" },
    {
      type: "item.started",
      threadId,
      itemId: "msg-user-2",
      itemType: "user_message",
      payload: { content: [{ kind: "text", text: "Verify these figures please." }] },
    },
    { type: "item.completed", threadId, itemId: "msg-user-2" },
  ];
  dbApplyThreadRuntimeEvents(threadId, events);
}

describe.skipIf(!sqliteAvailable)("consultation production wiring (real sqlite)", () => {
  let dir: string;
  let repository: SqliteConsultationRepository;

  beforeEach(() => {
    dir = setupTempDb();
    repository = new SqliteConsultationRepository();
    seedProjectAndThread("campaign-group-1");
  });
  afterEach(() => {
    teardownTempDb(dir);
  });

  it("submits a mention through the handler → coordinator → durable completed consultation", async () => {
    const { coordinator } = createTestCoordinator({
      repository,
      catalog: [{ provider: "codex", models: ["codex-model"], authenticated: true }],
    });
    const handler = new ConsultationSubmissionHandler({ coordinator, repository });

    const result = await handler.submit({
      projectId: PROJECT_ID,
      parentThreadId: THREAD_ID,
      campaignGroupId: "campaign-group-1",
      message: "@codex verify these figures",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consultation.resolvedRole).toBe("daily_operator");
    expect(result.consultation.requestedProvider).toBe("codex");

    const completed = await waitForTerminal(coordinator, result.consultation.id, 5000);
    expect(completed.status).toBe("completed");
    expect(completed.actualProvider).toBe("codex");
    // Durable: the record + a parsed result survive in the real repository.
    expect(repository.getConsultation(result.consultation.id)?.status).toBe("completed");
    expect(repository.getResultForConsultation(result.consultation.id)?.summary.length).toBeGreaterThan(0);
  });

  it("returns a structured error for a malformed mention and creates no record", async () => {
    const { coordinator } = createTestCoordinator({ repository });
    const handler = new ConsultationSubmissionHandler({ coordinator, repository });

    const result = await handler.submit({
      projectId: PROJECT_ID,
      parentThreadId: THREAD_ID,
      campaignGroupId: "campaign-group-1",
      message: "@verify",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("missing_instruction");
    expect(repository.listByParentThread(THREAD_ID)).toHaveLength(0);
  });

  it("loads the real parent-thread messages in order, excluding hidden reasoning", () => {
    seedParentMessages(THREAD_ID);
    const turns = loadParentThreadMessages(THREAD_ID, 50);

    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[0]?.content).toBe("How is the campaign pacing?");
    expect(turns[1]?.content).toBe("Spend is tracking ahead of plan.");
    // Stable message ids for summary reuse.
    expect(turns[0]?.messageId).toBe("msg-user-1");
    // Hidden chain-of-thought never appears.
    expect(turns.some((turn) => turn.content.includes("hidden chain-of-thought"))).toBe(false);
  });

  it("applies the configured message limit to the most-recent turns", () => {
    seedParentMessages(THREAD_ID);
    const turns = loadParentThreadMessages(THREAD_ID, 2);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.content).toBe("Spend is tracking ahead of plan.");
    expect(turns[1]?.content).toBe("Verify these figures please.");
  });

  it("builds a persisted context packet that contains the real parent conversation", async () => {
    seedParentMessages(THREAD_ID);
    const clock = new DeterministicClock();
    const ids = new SequentialIdGenerator();
    const builder = new ContextPacketBuilder({
      repository,
      contextProvider: new FixtureCampaignContextProvider(),
      threadSummaryService: new ThreadSummaryService({
        repository,
        generator: new DeterministicSummaryGenerator(),
        clock,
        idGenerator: ids,
      }),
      parentThreadPort: new LoaderParentThreadPort(createParentThreadLoader(dir)),
      clock,
      idGenerator: ids,
    });

    // The context packet FK references the consultation row, so persist it first.
    repository.saveConsultation({
      id: "consultation-ctx-1",
      parentProjectId: PROJECT_ID,
      parentThreadId: THREAD_ID,
      campaignGroupId: "campaign-group-1",
      childThreadOrRunId: null,
      originalMention: "@figures-auditor verify",
      originalInstruction: "verify these figures",
      resolvedRole: "figures_auditor",
      requestedProvider: null,
      actualProvider: null,
      requestedModel: null,
      actualModel: null,
      consultationMode: "standard",
      status: "building_context",
      contextPacketId: null,
      permissionPolicyVersion: "campaign-consultation-policy-v1",
      actor: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      failureCode: null,
      safeFailureMessage: null,
      resultSummaryId: null,
      retryOfConsultationId: null,
    });

    const built = await builder.build({
      consultationId: "consultation-ctx-1",
      parentProjectId: PROJECT_ID,
      parentThreadId: THREAD_ID,
      campaignGroupId: "campaign-group-1",
      role: "figures_auditor",
      originalMention: "@figures-auditor verify",
      explicitTask: "verify these figures",
    });

    const conversation = built.body.relevantRecentConversation.map((turn) => turn.content);
    expect(conversation).toContain("How is the campaign pacing?");
    expect(conversation).toContain("Verify these figures please.");
    expect(conversation.some((content) => content.includes("hidden chain-of-thought"))).toBe(false);
    // The exact packet is persisted with a content hash.
    const persisted = repository.getContextPacket(built.record.id);
    expect(persisted?.contentHash).toBe(built.record.contentHash);
    expect(persisted?.structuredContext.relevantRecentConversation.length).toBeGreaterThan(0);
  });

  it("attaches a completed result to the parent thread idempotently (no duplicate message)", () => {
    seedParentMessages(THREAD_ID);
    const emitted: SupervisorEvent[] = [];
    const attacher = createResultAttacher({ repository, emit: (event) => emitted.push(event) });

    const record = {
      id: "consultation-attach-1",
      parentProjectId: PROJECT_ID,
      parentThreadId: THREAD_ID,
      campaignGroupId: "campaign-group-1",
      childThreadOrRunId: "child-1",
      originalMention: "@codex verify",
      originalInstruction: "verify these figures",
      resolvedRole: "daily_operator" as const,
      requestedProvider: "codex",
      actualProvider: "codex",
      requestedModel: null,
      actualModel: "codex-model",
      consultationMode: "standard" as const,
      status: "completed" as const,
      contextPacketId: null,
      permissionPolicyVersion: "campaign-consultation-policy-v1",
      actor: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:02.000Z",
      cancelledAt: null,
      failureCode: null,
      safeFailureMessage: null,
      resultSummaryId: "result-1",
      retryOfConsultationId: null,
    };
    const resultRecord: ConsultationResultRecord = {
      id: "result-1",
      consultationId: record.id,
      summary: "Figures verified; spend is ahead of plan.",
      keyFindings: ["Pacing ahead of plan"],
      evidenceReferences: ["spend_vs_plan"],
      assumptions: ["Plan figures current"],
      uncertainties: ["Google sync stale"],
      recommendedActions: ["Rebalance toward Google"],
      suggestedProposalInputs: [],
      generatedFileReferences: [],
      completedAt: "2026-01-01T00:00:02.000Z",
    };
    repository.saveConsultation(record);
    repository.saveResult(resultRecord);

    const attachment = buildResultAttachment(record, resultRecord);
    attacher(attachment);
    attacher(attachment); // repeated completion callback

    const runtimeEvents = emitted
      .filter((event): event is Extract<SupervisorEvent, { type: "thread-runtime-event" }> =>
        event.type === "thread-runtime-event",
      )
      .map((event) => event.event);
    expect(runtimeEvents.length).toBe(4); // two item.started + two item.completed

    // Applying the emitted events twice still yields a single parent message row
    // (INSERT OR IGNORE on the deterministic consultation-result item id).
    dbApplyThreadRuntimeEvents(THREAD_ID, runtimeEvents);
    dbApplyThreadRuntimeEvents(THREAD_ID, runtimeEvents);
    const items = dbGetThreadRuntimeItems(THREAD_ID);
    const attachmentRows = items.filter((item) => item.id === consultationResultItemId(record.id));
    expect(attachmentRows).toHaveLength(1);
    expect(attachmentRows[0]?.type).toBe("assistant_message");
  });

  it("preserves completed consultations across a restart without re-launching children", async () => {
    const first = createTestCoordinator({
      repository,
      catalog: [{ provider: "codex", models: ["codex-model"], authenticated: true }],
    });
    const handler = new ConsultationSubmissionHandler({ coordinator: first.coordinator, repository });
    const submitted = await handler.submit({
      projectId: PROJECT_ID,
      parentThreadId: THREAD_ID,
      campaignGroupId: "campaign-group-1",
      message: "@codex verify these figures",
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    await waitForTerminal(first.coordinator, submitted.consultation.id, 5000);
    expect(repository.getConsultation(submitted.consultation.id)?.status).toBe("completed");

    // A fresh coordinator models a supervisor restart over the same durable store.
    const restarted = createTestCoordinator({
      repository,
      catalog: [{ provider: "codex", models: ["codex-model"], authenticated: true }],
    });
    const report = await restarted.coordinator.reconcileOnStartup();
    expect(report.preservedCompleted).toBeGreaterThanOrEqual(1);
    expect(report.resumed).not.toContain(submitted.consultation.id);
    expect(repository.getConsultation(submitted.consultation.id)?.status).toBe("completed");
    // No duplicate child launches for the already-completed consultation.
    expect(restarted.childExecution.launchCount).toBe(0);
  });
});
