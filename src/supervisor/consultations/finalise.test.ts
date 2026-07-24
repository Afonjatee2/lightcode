import { describe, expect, it } from "vitest";
import {
  InMemoryConsultationRepository,
  createTestCoordinator,
  waitForTerminal,
} from "./testing";

const BASE = {
  parentProjectId: "p-1",
  parentThreadId: "t-1",
  campaignGroupId: "g-1",
  actor: "user",
};

function setup() {
  const repository = new InMemoryConsultationRepository();
  const harness = createTestCoordinator({ repository });
  return { ...harness, repository };
}

describe("finalise mode", () => {
  it("synthesises completed consultations, referencing their ids and preserving disagreement", async () => {
    const { coordinator, repository } = setup();
    const a = await coordinator.submit({ ...BASE, role: "researcher", originalMention: "@researcher a", instruction: "assess" });
    const b = await coordinator.submit({ ...BASE, role: "challenger", originalMention: "@challenger b", instruction: "assess" });
    await waitForTerminal(coordinator, a.id);
    await waitForTerminal(coordinator, b.id);

    const finalise = await coordinator.finalise({
      ...BASE,
      originalMention: "@finalise combine",
      instruction: "combine the reviews",
      consultationIds: [a.id, b.id],
    });
    const done = await waitForTerminal(coordinator, finalise.id);
    expect(done.status).toBe("completed");
    expect(done.consultationMode).toBe("finalise");

    const result = repository.getResult(done.resultSummaryId!);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain(a.id);
    expect(result!.summary).toContain(b.id);
    expect(result!.summary.toLowerCase()).toContain("not reconciled");
  });

  it("excludes non-completed consultations and records that they were skipped", async () => {
    const { coordinator, repository, childExecution } = setup();
    const good = await coordinator.submit({ ...BASE, role: "researcher", originalMention: "@researcher ok", instruction: "assess" });
    await waitForTerminal(coordinator, good.id);
    childExecution.enqueueNext({ outcome: { status: "failed", rawOutput: "", errorMessage: "boom" } });
    const bad = await coordinator.submit({ ...BASE, role: "challenger", originalMention: "@challenger bad", instruction: "assess" });
    await waitForTerminal(coordinator, bad.id);

    const finalise = await coordinator.finalise({
      ...BASE,
      originalMention: "@finalise combine",
      instruction: "combine",
      consultationIds: [good.id, bad.id],
    });
    const done = await waitForTerminal(coordinator, finalise.id);
    const result = repository.getResult(done.resultSummaryId!);
    expect(result!.summary).toContain(good.id);
    expect(result!.summary).toContain("Excluded");
    expect(result!.summary).toContain(bad.id);
  });

  it("fails when no completed consultations are supplied", async () => {
    const { coordinator } = setup();
    const finalise = await coordinator.finalise({
      ...BASE,
      originalMention: "@finalise combine",
      instruction: "combine",
      consultationIds: ["does-not-exist"],
    });
    const done = await waitForTerminal(coordinator, finalise.id);
    expect(done.status).toBe("failed");
  });
});
