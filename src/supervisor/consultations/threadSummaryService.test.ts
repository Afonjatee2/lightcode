import { describe, expect, it } from "vitest";
import type { ConversationTurn } from "@/shared/consultations";
import {
  DeterministicClock,
  DeterministicSummaryGenerator,
  InMemoryConsultationRepository,
  SequentialIdGenerator,
} from "./testing";
import { ThreadSummaryService } from "./threadSummaryService";
import type { SummaryGenerator } from "./ports";

function turn(role: "user" | "assistant", id: string, content = "hello"): ConversationTurn {
  return { role, content, messageId: id, createdAt: "2026-07-22T00:00:00.000Z" };
}

function makeService(generatorOverride?: SummaryGenerator, maxAgeMs?: number) {
  const repository = new InMemoryConsultationRepository();
  const clock = new DeterministicClock();
  const ids = new SequentialIdGenerator();
  const summaryGenerator = new DeterministicSummaryGenerator();
  const service = new ThreadSummaryService({
    repository,
    generator: generatorOverride ?? summaryGenerator,
    clock,
    idGenerator: ids,
    ...(maxAgeMs ? { maxAgeMs } : {}),
  });
  return { service, repository, clock, summaryGenerator };
}

describe("thread summary reuse", () => {
  it("generates and persists a summary when none exists", async () => {
    const { service, repository, summaryGenerator } = makeService();
    const summary = await service.ensureSummary({
      threadId: "t-1",
      messages: [turn("user", "m1"), turn("assistant", "m2")],
      provider: "p",
      model: "m",
    });
    expect(summary.summary).toContain("t-1");
    expect(summaryGenerator.generateCount).toBe(1);
    expect(repository.getLatestThreadSummary("t-1")?.id).toBe(summary.id);
  });

  it("reuses the existing summary when no meaningful messages were added", async () => {
    const { service, summaryGenerator } = makeService();
    const messages = [turn("user", "m1"), turn("assistant", "m2")];
    const first = await service.ensureSummary({ threadId: "t-1", messages, provider: "p", model: "m" });
    const second = await service.ensureSummary({ threadId: "t-1", messages, provider: "p", model: "m" });
    expect(second.id).toBe(first.id);
    expect(summaryGenerator.generateCount).toBe(1);
  });

  it("regenerates when a meaningful message lands after the source cursor", async () => {
    const { service, summaryGenerator } = makeService();
    await service.ensureSummary({
      threadId: "t-1",
      messages: [turn("user", "m1"), turn("assistant", "m2")],
      provider: "p",
      model: "m",
    });
    const updated = await service.ensureSummary({
      threadId: "t-1",
      messages: [turn("user", "m1"), turn("assistant", "m2"), turn("user", "m3", "new question")],
      provider: "p",
      model: "m",
    });
    expect(summaryGenerator.generateCount).toBe(2);
    expect(updated.sourceCursor).toBe("m3");
  });

  it("never persists an identical regenerated summary", async () => {
    const fixed: SummaryGenerator = { generate: async () => "IDENTICAL SUMMARY" };
    const { service } = makeService(fixed);
    const first = await service.ensureSummary({
      threadId: "t-1",
      messages: [turn("user", "m1")],
      provider: "p",
      model: "m",
    });
    // A new meaningful message triggers regeneration, but the generator returns
    // identical text → same hash → the existing row is reused, not duplicated.
    const second = await service.ensureSummary({
      threadId: "t-1",
      messages: [turn("user", "m1"), turn("user", "m2", "more")],
      provider: "p",
      model: "m",
    });
    expect(second.id).toBe(first.id);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("regenerates once the age threshold elapses even without new messages", async () => {
    const { service, clock, summaryGenerator } = makeService(undefined, 1000);
    const messages = [turn("user", "m1")];
    await service.ensureSummary({ threadId: "t-1", messages, provider: "p", model: "m" });
    clock.advance(5_000);
    await service.ensureSummary({ threadId: "t-1", messages, provider: "p", model: "m" });
    expect(summaryGenerator.generateCount).toBe(2);
  });
});
