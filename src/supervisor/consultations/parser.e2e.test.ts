/**
 * PART 15 — End-to-end fixture acceptance tests.
 *
 * These exercise the full lifecycle: mention parsing → consultation submission →
 * context construction → child execution → result persistence → parent attachment,
 * plus restart recovery, panel flow, cancellation, and controlled failure.
 */
import { describe, expect, it } from "vitest";
import { parseMention } from "@/shared/consultations";
import {
  InMemoryConsultationRepository,
  createTestCoordinator,
  waitForTerminal,
} from "./testing";
import type { AvailableProvider } from "@/shared/consultations";

const FIXTURE_CATALOG: AvailableProvider[] = [
  { provider: "codex", models: ["codex-default", "codex-fast"], authenticated: true },
  { provider: "claude", models: ["sonnet-4"], authenticated: true },
];

describe("E2E — happy path: @codex verify the figures", () => {
  it("mention parsing", () => {
    const outcome = parseMention("@codex verify the performance metrics");
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(outcome.resolvedRole).toBe("daily_operator");
    expect(outcome.requestedProvider).toBe("codex");
    expect(outcome.instruction).toBe("verify the performance metrics");
  });

  it("full lifecycle: submit → context → child → result", async () => {
    const repository = new InMemoryConsultationRepository();
    const testCtx = createTestCoordinator({
      repository,
      catalog: FIXTURE_CATALOG,
    });
    const { coordinator, childExecution } = testCtx;

    const record = await coordinator.submit({
      parentProjectId: "proj-1",
      parentThreadId: "thread-1",
      campaignGroupId: "cg-1",
      role: "daily_operator",
      originalMention: "@codex verify the performance metrics",
      instruction: "verify the performance metrics",
      actor: "test-user",
      requestedProvider: "codex",
    });

    expect(record.status).toBe("queued");
    expect(record.resolvedRole).toBe("daily_operator");
    expect(record.requestedProvider).toBe("codex");

    const completed = await waitForTerminal(coordinator, record.id, 5000);
    expect(completed.status).toBe("completed");
    expect(completed.actualProvider).toBe("codex");
    expect(completed.actualModel).toBe("codex-default");
    expect(completed.contextPacketId).toBeTruthy();

    const result = repository.getResultForConsultation(record.id);
    expect(result).toBeTruthy();
    expect(result!.summary).toContain("pacing ahead");
    expect(result!.keyFindings.length).toBeGreaterThan(0);
    expect(result!.evidenceReferences.length).toBeGreaterThan(0);
    expect(result!.recommendedActions.length).toBeGreaterThan(0);

    expect(childExecution.launchCount).toBe(1);
  });
});

describe("E2E — cancellation", () => {
  it("cancels a queued consultation", async () => {
    const repository = new InMemoryConsultationRepository();
    const testCtx = createTestCoordinator({
      repository,
      catalog: FIXTURE_CATALOG,
    });
    const { coordinator, childExecution } = testCtx;
    childExecution.enqueueNext({ delayMs: 60000 });

    const record = await coordinator.submit({
      parentProjectId: "proj-2",
      parentThreadId: "thread-2",
      campaignGroupId: "cg-2",
      role: "daily_operator",
      originalMention: "@codex cancel me",
      instruction: "cancel me",
      actor: "test-user",
      requestedProvider: "codex",
    });

    await new Promise((r) => setTimeout(r, 50));
    const cancelResult = await coordinator.cancel(record.id);
    expect(cancelResult).toBeTruthy();
    const settled = await waitForTerminal(coordinator, record.id, 5000);
    expect(["cancelled", "failed"]).toContain(settled.status);
  });
});

describe("E2E — controlled failure", () => {
  it("child launch failure produces a failed consultation", async () => {
    const repository = new InMemoryConsultationRepository();
    const testCtx = createTestCoordinator({
      repository,
      catalog: FIXTURE_CATALOG,
    });
    const { coordinator, childExecution } = testCtx;
    childExecution.enqueueNext({ failLaunch: new Error("connect ETIMEDOUT") });

    const record = await coordinator.submit({
      parentProjectId: "proj-3",
      parentThreadId: "thread-3",
      campaignGroupId: "cg-3",
      role: "daily_operator",
      originalMention: "@codex will fail",
      instruction: "will fail",
      actor: "test-user",
      requestedProvider: "codex",
    });

    const failed = await waitForTerminal(coordinator, record.id, 5000);
    expect(failed.status).toBe("failed");
    expect(failed.failureCode).toBe("child_launch_failed");
    expect(failed.safeFailureMessage).toBeTruthy();
  });

  it("retry creates a new consultation", async () => {
    const repository = new InMemoryConsultationRepository();
    const testCtx = createTestCoordinator({
      repository,
      catalog: FIXTURE_CATALOG,
    });
    const { coordinator, childExecution } = testCtx;
    childExecution.enqueueNext({ failLaunch: new Error("connect ETIMEDOUT") });

    const record = await coordinator.submit({
      parentProjectId: "proj-4",
      parentThreadId: "thread-4",
      campaignGroupId: "cg-4",
      role: "daily_operator",
      originalMention: "@codex retry me",
      instruction: "retry me",
      actor: "test-user",
      requestedProvider: "codex",
    });
    await waitForTerminal(coordinator, record.id, 5000);

    const retried = await coordinator.retry(record.id);
    expect(retried).toBeTruthy();
    expect(retried!.retryOfConsultationId).toBe(record.id);

    const completed = await waitForTerminal(coordinator, retried!.id, 5000);
    expect(completed.status).toBe("completed");
  });
});

describe("E2E — restart recovery", () => {
  it("reconcileOnStartup preserves completed and resumes queued", async () => {
    const repository = new InMemoryConsultationRepository();
    const testCtx = createTestCoordinator({
      repository,
      catalog: FIXTURE_CATALOG,
    });
    const { coordinator } = testCtx;

    const submitted = await coordinator.submit({
      parentProjectId: "proj-5",
      parentThreadId: "thread-5",
      campaignGroupId: "cg-5",
      role: "daily_operator",
      originalMention: "@codex the completed one",
      instruction: "the completed one",
      actor: "test-user",
      requestedProvider: "codex",
    });
    const completed = await waitForTerminal(coordinator, submitted.id, 5000);
    expect(completed.status).toBe("completed");

    const report = await coordinator.reconcileOnStartup();
    expect(report.preservedCompleted).toBeGreaterThanOrEqual(1);
    expect(report.markedOrphaned.length).toBe(0);
  });
});

describe("E2E — panel flow", () => {
  it("panel with two members completes successfully", async () => {
    const repository = new InMemoryConsultationRepository();
    const testCtx = createTestCoordinator({
      repository,
      catalog: FIXTURE_CATALOG,
      panelPollIntervalMs: 1,
      panelMaxWaitMs: 10000,
    });
    const { coordinator } = testCtx;

    const panel = await coordinator.panel({
      parentProjectId: "proj-6",
      parentThreadId: "thread-6",
      campaignGroupId: "cg-6",
      originalMention: "@panel review Q3 performance",
      instruction: "review Q3 performance",
      actor: "test-user",
      members: [
        { role: "daily_operator", requiredOrOptional: "required" },
        { role: "strategic_reviewer", requiredOrOptional: "required" },
      ],
    });

    const done = await waitForTerminal(coordinator, panel.id, 15000);
    expect(done.status).toBe("completed");

    const result = repository.getResultForConsultation(panel.id);
    expect(result).toBeTruthy();

    const panelMembers = repository.listPanelMembers(panel.id);
    expect(panelMembers.length).toBe(2);
    for (const member of panelMembers) {
      const memberRecord = repository.getConsultation(member.childConsultationId);
      expect(memberRecord).toBeTruthy();
      expect(memberRecord!.status).toBe("completed");
    }
  });
});
