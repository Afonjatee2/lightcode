import { describe, expect, it } from "vitest";
import type { ConsultationRecord } from "./types";
import {
  IllegalTransitionError,
  VALID_TRANSITIONS,
  canTransition,
  transition,
} from "./stateMachine";
import { CONSULTATION_STATUSES } from "./types";

function record(status: ConsultationRecord["status"]): ConsultationRecord {
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
    status,
    contextPacketId: null,
    permissionPolicyVersion: "v1",
    actor: "user",
    createdAt: "2026-07-22T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    safeFailureMessage: null,
    resultSummaryId: null,
    retryOfConsultationId: null,
  };
}

describe("consultation state machine", () => {
  it("permits the documented forward edges", () => {
    expect(canTransition("queued", "building_context")).toBe(true);
    expect(canTransition("building_context", "ready")).toBe(true);
    expect(canTransition("ready", "running")).toBe(true);
    expect(canTransition("running", "awaiting_input")).toBe(true);
    expect(canTransition("awaiting_input", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("cancel_requested", "cancelled")).toBe(true);
    expect(canTransition("cancel_requested", "completed")).toBe(true);
  });

  it("forbids skipping the lifecycle and leaving terminal states", () => {
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("queued", "running")).toBe(false);
    expect(canTransition("building_context", "completed")).toBe(false);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
  });

  it("transition() throws on illegal edges and never mutates the input", () => {
    const queued = record("queued");
    expect(() => transition(queued, "completed")).toThrow(IllegalTransitionError);
    expect(queued.status).toBe("queued");
  });

  it("transition() stamps startedAt/completedAt/cancelledAt at the right edges", () => {
    const at = "2026-07-22T01:00:00.000Z";
    const running = transition(record("ready"), "running", at);
    expect(running.startedAt).toBe(at);
    const completed = transition(running, "completed", at);
    expect(completed.completedAt).toBe(at);
    const cancelled = transition(record("running"), "cancelled", at);
    expect(cancelled.cancelledAt).toBe(at);
    expect(cancelled.completedAt).toBe(at);
  });

  it("every status appears in the transition table and terminals have no edges", () => {
    for (const status of CONSULTATION_STATUSES) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
    }
    expect(VALID_TRANSITIONS.completed).toEqual([]);
    expect(VALID_TRANSITIONS.failed).toEqual([]);
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
  });
});
