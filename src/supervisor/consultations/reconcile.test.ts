import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConsultationRecord, ConsultationStatus } from "@/shared/consultations";
import { SqliteConsultationRepository } from "./sqliteRepository";
import { createTestCoordinator, waitForTerminal } from "./testing";
import { setupTempDb, sqliteAvailable, teardownTempDb } from "./sqliteTestHarness";

function record(id: string, status: ConsultationStatus, overrides: Partial<ConsultationRecord> = {}): ConsultationRecord {
  return {
    id,
    parentProjectId: "p-1",
    parentThreadId: "t-1",
    campaignGroupId: "g-1",
    childThreadOrRunId: null,
    originalMention: "@daily_operator check",
    originalInstruction: "check",
    resolvedRole: "daily_operator",
    requestedProvider: null,
    actualProvider: null,
    requestedModel: null,
    actualModel: null,
    consultationMode: "standard",
    status,
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

describe.skipIf(!sqliteAvailable)("restart reconciliation (real sqlite)", () => {
  let dir: string;
  let repository: SqliteConsultationRepository;

  beforeEach(() => {
    dir = setupTempDb();
    repository = new SqliteConsultationRepository();
  });
  afterEach(() => {
    teardownTempDb(dir);
  });

  it("resumes safe queued work, preserves completed work, and reports counts", async () => {
    const { coordinator } = createTestCoordinator({ repository });
    repository.saveConsultation(record("queued-1", "queued"));
    repository.saveConsultation(record("done-1", "completed", { completedAt: "2026-07-22T00:30:00.000Z" }));

    const report = await coordinator.reconcileOnStartup();
    expect(report.resumed).toContain("queued-1");
    expect(report.preservedCompleted).toBe(1);

    const resumed = await waitForTerminal(coordinator, "queued-1", 5000);
    expect(resumed.status).toBe("completed");
    // The completed record is untouched.
    expect(repository.getConsultation("done-1")?.status).toBe("completed");
  });

  it("marks a running consultation whose child is gone as orphaned (failed)", async () => {
    const { coordinator } = createTestCoordinator({ repository });
    repository.saveConsultation(record("run-gone", "running", { childThreadOrRunId: "ghost-child" }));

    const report = await coordinator.reconcileOnStartup();
    expect(report.markedOrphaned).toContain("run-gone");
    expect(repository.getConsultation("run-gone")?.status).toBe("failed");
    expect(repository.getConsultation("run-gone")?.safeFailureMessage).toContain("orphan");
  });

  it("resumes observation of a running consultation whose child is still active", async () => {
    const { coordinator, childExecution } = createTestCoordinator({ repository });
    // A live child the fixture knows about (default completed outcome).
    const launched = await childExecution.launch({
      parentThreadId: "t-1",
      provider: "fixture",
      model: "fixture-model",
      prompt: "x",
    });
    repository.saveConsultation(record("run-active", "running", { childThreadOrRunId: launched.childThreadOrRunId }));

    const report = await coordinator.reconcileOnStartup();
    expect(report.resumed).toContain("run-active");
    const resumed = await waitForTerminal(coordinator, "run-active", 5000);
    expect(resumed.status).toBe("completed");
  });

  it("completes a pending cancellation on startup", async () => {
    const { coordinator } = createTestCoordinator({ repository });
    repository.saveConsultation(record("cancel-1", "cancel_requested", { childThreadOrRunId: "some-child" }));

    const report = await coordinator.reconcileOnStartup();
    expect(report.cancelled).toContain("cancel-1");
    expect(repository.getConsultation("cancel-1")?.status).toBe("cancelled");
  });

  it("marks mid-setup consultations (building_context/ready) interrupted, not relaunched", async () => {
    const { coordinator, childExecution } = createTestCoordinator({ repository });
    repository.saveConsultation(record("building-1", "building_context"));
    repository.saveConsultation(record("ready-1", "ready"));

    const report = await coordinator.reconcileOnStartup();
    expect(report.markedInterrupted).toEqual(expect.arrayContaining(["building-1", "ready-1"]));
    expect(repository.getConsultation("building-1")?.status).toBe("failed");
    expect(repository.getConsultation("ready-1")?.status).toBe("failed");
    // No duplicate child launches for the interrupted records.
    expect(childExecution.launchCount).toBe(0);
  });

  it("reconcileOnStartup is idempotent — a second call is a no-op", async () => {
    const { coordinator } = createTestCoordinator({ repository });
    repository.saveConsultation(record("queued-1", "queued"));

    const first = await coordinator.reconcileOnStartup();
    expect(first.resumed).toContain("queued-1");

    const second = await coordinator.reconcileOnStartup();
    expect(second.resumed).toHaveLength(0);
    expect(second.markedOrphaned).toHaveLength(0);
    expect(second.markedInterrupted).toHaveLength(0);
    expect(second.cancelled).toHaveLength(0);
  });

  it("does not mark a running consultation as orphaned when its child is seeded first", async () => {
    const { coordinator, childExecution } = createTestCoordinator({ repository });
    // Seed the child first, as seedOrchestratorChildren would do BEFORE reconciliation.
    const launched = await childExecution.launch({
      parentThreadId: "t-1",
      provider: "fixture",
      model: "fixture-model",
      prompt: "x",
    });
    // Persist the consultation referencing the seeded child.
    repository.saveConsultation(record("run-live", "running", { childThreadOrRunId: launched.childThreadOrRunId }));

    // Reconcile must NOT orphan this record — its child was seeded first.
    const report = await coordinator.reconcileOnStartup();
    expect(report.markedOrphaned).not.toContain("run-live");
    expect(report.resumed).toContain("run-live");
    // The consultation completes normally.
    const finished = await waitForTerminal(coordinator, "run-live", 5000);
    expect(finished.status).toBe("completed");
  });

  it("reconciles queued + building_context + cancel_requested when no persisted child threads exist", async () => {
    const { coordinator } = createTestCoordinator({ repository });
    // Zero children seeded — simulates the empty-children path where main.ts
    // still calls seedOrchestratorChildren({ children: [] }).
    repository.saveConsultation(record("queued-0", "queued"));
    repository.saveConsultation(record("building-0", "building_context"));
    repository.saveConsultation(record("cancel-0", "cancel_requested", { childThreadOrRunId: "old-child" }));

    const report = await coordinator.reconcileOnStartup();
    expect(report.resumed).toContain("queued-0");
    expect(report.markedInterrupted).toContain("building-0");
    expect(report.cancelled).toContain("cancel-0");
    expect(repository.getConsultation("cancel-0")?.status).toBe("cancelled");
  });

  it("retries reconciliation after child inspection throws once", async () => {
    const { coordinator, childExecution } = createTestCoordinator({ repository });
    childExecution.setInspect("ghost-child", "active"); // Will fail on first attempt
    repository.saveConsultation(record("run-ghost", "running", { childThreadOrRunId: "ghost-child" }));

    // Make inspection throw once then succeed
    let callCount = 0;
    const originalInspect = childExecution.inspect.bind(childExecution);
    childExecution.inspect = async (id) => {
      callCount += 1;
      if (callCount === 1) throw new Error("transient inspection failure");
      return originalInspect(id);
    };

    // First reconciliation throws
    await expect(coordinator.reconcileOnStartup()).rejects.toThrow("retryable");

    // Second reconciliation succeeds
    const report = await coordinator.reconcileOnStartup();
    expect(report.resumed).toContain("run-ghost");
  });
});
