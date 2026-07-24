import { describe, expect, it } from "vitest";
import {
  InMemoryConsultationRepository,
  createTestCoordinator,
  waitForConsultation,
  waitForTerminal,
} from "./testing";

const PANEL = {
  parentProjectId: "p-1",
  parentThreadId: "t-1",
  campaignGroupId: "g-1",
  originalMention: "@panel review the plan",
  instruction: "review the plan",
  actor: "user",
  members: [
    { role: "researcher" as const },
    { role: "challenger" as const },
  ],
};

function setup() {
  const repository = new InMemoryConsultationRepository();
  const attachments: unknown[] = [];
  const harness = createTestCoordinator({
    repository,
    attachResult: (attachment) => attachments.push(attachment),
  });
  return { ...harness, repository, attachments };
}

describe("panel mode", () => {
  it("creates a durable panel with two REAL child consultations and synthesises after they complete", async () => {
    const { coordinator, childExecution, repository } = setup();
    const panel = await coordinator.panel(PANEL);
    const done = await waitForTerminal(coordinator, panel.id, 5000);

    expect(done.status).toBe("completed");
    expect(done.consultationMode).toBe("panel");
    expect(done.resultSummaryId).not.toBeNull();
    // Two real member child runs were launched (the panel parent launches none).
    expect(childExecution.launchCount).toBe(2);

    const members = repository.listPanelMembers(panel.id);
    expect(members).toHaveLength(2);
    for (const membership of members) {
      const member = repository.getConsultation(membership.childConsultationId);
      expect(member).not.toBeNull();
      expect(member!.childThreadOrRunId).not.toBeNull();
      expect(member!.status).toBe("completed");
    }
  });

  it("preserves disagreement: the synthesis reports each member independently", async () => {
    const { coordinator, repository } = setup();
    const panel = await coordinator.panel(PANEL);
    const done = await waitForTerminal(coordinator, panel.id, 5000);
    const result = repository.getResult(done.resultSummaryId!);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("researcher");
    expect(result!.summary).toContain("challenger");
    expect(result!.keyFindings.some((finding) => finding.startsWith("[researcher]"))).toBe(true);
    expect(result!.keyFindings.some((finding) => finding.startsWith("[challenger]"))).toBe(true);
  });

  it("handles partial failure: a failed member is noted, the panel still synthesises", async () => {
    const { coordinator, childExecution, repository } = setup();
    childExecution.enqueueNext({ outcome: { status: "failed", rawOutput: "", errorMessage: "member boom" } });
    const panel = await coordinator.panel(PANEL);
    const done = await waitForTerminal(coordinator, panel.id, 5000);

    expect(done.status).toBe("completed");
    const members = repository.listPanelMembers(panel.id);
    const statuses = members.map((m) => repository.getConsultation(m.childConsultationId)!.status).sort();
    expect(statuses).toEqual(["completed", "failed"]);

    const result = repository.getResult(done.resultSummaryId!);
    expect(result!.summary.toLowerCase()).toContain("failed");
    expect(result!.uncertainties.length).toBeGreaterThan(0);
  });

  it("supports panel cancellation: the panel and its members settle cancelled", async () => {
    const { coordinator, childExecution, repository } = setup();
    childExecution.enqueueNext({ delayMs: 5_000 });
    childExecution.enqueueNext({ delayMs: 5_000 });
    const panel = await coordinator.panel(PANEL);
    await waitForConsultation(coordinator, panel.id, (r) => r.status === "running", 5000);

    await coordinator.cancel(panel.id);
    const done = await waitForTerminal(coordinator, panel.id, 5000);
    expect(done.status).toBe("cancelled");

    const members = repository.listPanelMembers(panel.id);
    for (const membership of members) {
      const member = await waitForTerminal(coordinator, membership.childConsultationId, 5000);
      expect(member.status).toBe("cancelled");
    }
  });

  it("rejects a panel with fewer than two members", async () => {
    const { coordinator } = setup();
    await expect(
      coordinator.panel({ ...PANEL, members: [{ role: "researcher" as const }] }),
    ).rejects.toThrow(/at least two/);
  });
});
