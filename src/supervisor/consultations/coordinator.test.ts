import { describe, expect, it } from "vitest";
import { isTerminalStatus, type ConsultationResultAttachment } from "@/shared/consultations";
import {
  InMemoryConsultationRepository,
  createTestCoordinator,
  waitForConsultation,
  waitForTerminal,
} from "./testing";

const SUBMIT = {
  parentProjectId: "p-1",
  parentThreadId: "t-1",
  campaignGroupId: "g-1",
  role: "daily_operator" as const,
  originalMention: "@daily_operator check pacing",
  instruction: "check pacing",
  actor: "user",
};

function setup(options: { catalog?: Parameters<typeof createTestCoordinator>[0]["catalog"]; attach?: (a: ConsultationResultAttachment) => void } = {}) {
  const attachments: ConsultationResultAttachment[] = [];
  const harness = createTestCoordinator({
    repository: new InMemoryConsultationRepository(),
    ...(options.catalog ? { catalog: options.catalog } : {}),
    attachResult: (attachment) => {
      attachments.push(attachment);
      options.attach?.(attachment);
    },
  });
  return { ...harness, attachments };
}

describe("consultation coordinator lifecycle", () => {
  it("happy path: builds context, launches a real child, completes and attaches a safe result", async () => {
    const { coordinator, childExecution } = setup();
    const record = await coordinator.submit(SUBMIT);
    const done = await waitForTerminal(coordinator, record.id);

    expect(done.status).toBe("completed");
    expect(done.actualProvider).toBe("fixture");
    expect(done.actualModel).toBe("fixture-model");
    expect(done.childThreadOrRunId).not.toBeNull();
    expect(done.contextPacketId).not.toBeNull();
    expect(done.resultSummaryId).not.toBeNull();
    expect(childExecution.launchCount).toBe(1);
  });

  it("attaches exactly one safe result (no hidden reasoning, curated fields only)", async () => {
    const { coordinator, attachments } = setup();
    const record = await coordinator.submit(SUBMIT);
    await waitForTerminal(coordinator, record.id);

    expect(attachments).toHaveLength(1);
    const attachment = attachments[0]!;
    expect(attachment.consultationId).toBe(record.id);
    expect(attachment.role).toBe("daily_operator");
    expect(attachment.status).toBe("completed");
    expect(attachment.summary).toContain("pacing");
    expect(attachment.keyFindings.length).toBeGreaterThan(0);
    expect(attachment.suggestedProposalInputs[0]?.title).toBe("Shift 10% to Google");
    expect(JSON.stringify(attachment)).not.toContain("chain-of-thought");
  });

  it("fails with context_retrieval_failed when the campaign context provider errors", async () => {
    const { coordinator, contextProvider } = setup();
    contextProvider.setOverride("g-1", { failWith: new Error("Control Centre unavailable") });
    const record = await coordinator.submit(SUBMIT);
    const done = await waitForTerminal(coordinator, record.id);
    expect(done.status).toBe("failed");
    expect(done.failureCode).toBe("context_retrieval_failed");
  });

  it("fails with provider_unavailable when no provider can be resolved", async () => {
    const { coordinator } = setup({ catalog: [] });
    const record = await coordinator.submit(SUBMIT);
    const done = await waitForTerminal(coordinator, record.id);
    expect(done.status).toBe("failed");
    expect(done.failureCode).toBe("provider_unavailable");
  });

  it("fails with auth_failure when the requested provider is not authenticated", async () => {
    const { coordinator } = setup({
      catalog: [{ provider: "gemini", models: ["g-1"], authenticated: false }],
    });
    const record = await coordinator.submit({ ...SUBMIT, requestedProvider: "gemini" });
    const done = await waitForTerminal(coordinator, record.id);
    expect(done.status).toBe("failed");
    expect(done.failureCode).toBe("auth_failure");
  });

  it("fails with child_launch_failed when the child run cannot start", async () => {
    const { coordinator, childExecution } = setup();
    childExecution.enqueueNext({ failLaunch: new Error("launch boom") });
    const record = await coordinator.submit(SUBMIT);
    const done = await waitForTerminal(coordinator, record.id);
    expect(done.status).toBe("failed");
    expect(done.failureCode).toBe("child_launch_failed");
  });

  it("fails with execution_failed when the child run fails", async () => {
    const { coordinator, childExecution } = setup();
    childExecution.enqueueNext({ outcome: { status: "failed", rawOutput: "", errorMessage: "execution boom" } });
    const record = await coordinator.submit(SUBMIT);
    const done = await waitForTerminal(coordinator, record.id);
    expect(done.status).toBe("failed");
    expect(done.failureCode).toBe("execution_failed");
  });

  it("fails with result_parse_failed when the child produces no usable output", async () => {
    const { coordinator, childExecution } = setup();
    childExecution.enqueueNext({ outcome: { status: "completed", rawOutput: "   " } });
    const record = await coordinator.submit(SUBMIT);
    const done = await waitForTerminal(coordinator, record.id);
    expect(done.status).toBe("failed");
    expect(done.failureCode).toBe("result_parse_failed");
  });

  it("cancellation uses the real child-cancel mechanism and settles cancelled", async () => {
    const { coordinator, childExecution } = setup();
    childExecution.enqueueNext({ delayMs: 5_000 });
    const record = await coordinator.submit(SUBMIT);
    await waitForConsultation(coordinator, record.id, (r) => r.status === "running");
    await coordinator.cancel(record.id);
    const done = await waitForTerminal(coordinator, record.id);
    expect(done.status).toBe("cancelled");
    expect(childExecution.cancelCount).toBeGreaterThanOrEqual(1);
  });

  it("retry creates a LINKED new consultation and leaves the original failed record intact", async () => {
    const { coordinator, childExecution, repository } = setup();
    childExecution.enqueueNext({ outcome: { status: "failed", rawOutput: "", errorMessage: "boom" } });
    const original = await coordinator.submit(SUBMIT);
    const failed = await waitForTerminal(coordinator, original.id);
    expect(failed.status).toBe("failed");

    const retry = await coordinator.retry(original.id);
    expect(retry).not.toBeNull();
    expect(retry!.retryOfConsultationId).toBe(original.id);
    const retryDone = await waitForTerminal(coordinator, retry!.id);
    expect(retryDone.status).toBe("completed");

    // The original is untouched.
    expect(repository.getConsultation(original.id)?.status).toBe("failed");
    expect(repository.listRetriesOf(original.id).map((r) => r.id)).toEqual([retry!.id]);
  });

  it("retries a panel once with the same members, providers, models, order and completion rule", async () => {
    const repository = new InMemoryConsultationRepository();
    const { coordinator, childExecution } = createTestCoordinator({
      repository,
      catalog: [
        { provider: "fixture", models: ["fixture-model"], authenticated: true },
        { provider: "reviewer", models: ["review-model"], authenticated: true },
      ],
    });
    const originalPanel = {
      id: "panel-original",
      parentProjectId: "p-1",
      parentThreadId: "t-1",
      campaignGroupId: "g-1",
      childThreadOrRunId: null,
      originalMention: "@panel review the recommendation",
      originalInstruction: "review the recommendation",
      resolvedRole: "panel" as const,
      requestedProvider: null,
      actualProvider: null,
      requestedModel: null,
      actualModel: null,
      consultationMode: "panel" as const,
      status: "failed" as const,
      contextPacketId: null,
      permissionPolicyVersion: "campaign-consultation-policy-v1",
      actor: "user",
      createdAt: "2026-07-22T00:00:00.000Z",
      startedAt: null,
      completedAt: "2026-07-22T00:05:00.000Z",
      cancelledAt: null,
      failureCode: "execution_failed" as const,
      safeFailureMessage: "member failed",
      resultSummaryId: null,
      retryOfConsultationId: null,
      panelCompletionRule: { kind: "at_least" as const, count: 2 },
    };
    repository.saveConsultation(originalPanel);

    const memberSpecs = [
      { id: "old-1", role: "figures_auditor" as const, required: "required" as const, provider: "reviewer", model: "review-model" },
      { id: "old-2", role: "challenger" as const, required: "optional" as const, provider: "fixture", model: "fixture-model" },
      { id: "old-3", role: "researcher" as const, required: "required" as const, provider: "reviewer", model: "review-model" },
    ];
    memberSpecs.forEach((spec, sequence) => {
      repository.saveConsultation({
        ...originalPanel,
        id: spec.id,
        resolvedRole: spec.role,
        consultationMode: "standard",
        status: "completed",
        requestedProvider: spec.provider,
        requestedModel: spec.model,
        actualProvider: spec.provider,
        actualModel: spec.model,
        failureCode: null,
        safeFailureMessage: null,
        panelCompletionRule: null,
      });
      repository.savePanelMembership({
        parentPanelConsultationId: originalPanel.id,
        childConsultationId: spec.id,
        memberRole: spec.role,
        requiredOrOptional: spec.required,
        sequenceOrWeight: sequence,
      });
    });

    const retried = await coordinator.retry(originalPanel.id);
    expect(retried).not.toBeNull();
    expect(retried?.consultationMode).toBe("panel");
    expect(retried?.retryOfConsultationId).toBe(originalPanel.id);
    expect(retried?.panelCompletionRule).toEqual({ kind: "at_least", count: 2 });

    const completed = await waitForTerminal(coordinator, retried!.id);
    expect(completed.status).toBe("completed");
    expect(childExecution.launchCount).toBe(3);

    const retriedMemberships = repository.listPanelMembers(retried!.id);
    expect(retriedMemberships).toHaveLength(3);
    expect(retriedMemberships.map((member) => ({
      role: member.memberRole,
      required: member.requiredOrOptional,
      sequence: member.sequenceOrWeight,
    }))).toEqual(memberSpecs.map((spec, sequence) => ({
      role: spec.role,
      required: spec.required,
      sequence,
    })));

    const retriedChildren = retriedMemberships.map((member) =>
      repository.getConsultation(member.childConsultationId),
    );
    expect(retriedChildren.map((child) => child?.requestedProvider)).toEqual(
      memberSpecs.map((spec) => spec.provider),
    );
    expect(retriedChildren.map((child) => child?.requestedModel)).toEqual(
      memberSpecs.map((spec) => spec.model),
    );
    expect(repository.getConsultation(originalPanel.id)).toEqual(originalPanel);
  });

  it("does not retry a consultation that is not failed/cancelled", async () => {
    const { coordinator } = setup();
    const record = await coordinator.submit(SUBMIT);
    await waitForTerminal(coordinator, record.id);
    const retry = await coordinator.retry(record.id);
    expect(retry?.id).toBe(record.id);
  });

  it("ignores duplicate completion: a settled consultation is never re-driven or re-attached", async () => {
    const { coordinator, attachments } = setup();
    const record = await coordinator.submit(SUBMIT);
    await waitForTerminal(coordinator, record.id);
    expect(attachments).toHaveLength(1);
    // A second terminal signal for the same record must not attach again.
    await coordinator.cancel(record.id);
    expect(attachments).toHaveLength(1);
    expect(isTerminalStatus(coordinator.get(record.id)!.status)).toBe(true);
  });
});
