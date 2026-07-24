import { describe, expect, it } from "vitest";
import { adaptProposal, adaptProposalList } from "./controlCentreAdapter";

const BASE_FIXTURE = {
  id: "proposal-001",
  campaignGroupId: "cg-abc",
  actionType: "budget.update",
  title: "Increase daily budget",
  summary: "Raise Meta prospecting daily budget by £200",
  status: "awaiting_approval",
  target: {
    platform: "meta",
    entityType: "campaign",
    entityId: "meta-camp-123",
  },
  requestedChange: { budget: 500 },
  beforeState: { budget: 300 },
  expectedAfterState: { budget: 500 },
  appliedAfterState: null,
  evidencePacketId: "550e8400-e29b-41d4-a716-446655440000",
  riskLevel: "medium",
  riskReasons: ["Budget increase over £100 within tolerance"],
  requiresStrongConfirmation: false,
  idempotencyKey: "idem-budget-001",
  approvalNote: null,
  rejectionReason: null,
  approvedAt: null,
  rejectedAt: null,
  applyingAt: null,
  appliedAt: null,
  failedAt: null,
  expiresAt: null,
  platformResponse: null,
  errorDetails: null,
  rollbackGuidance: null,
};

describe("adaptProposal", () => {
  it("passes through a well-formed proposal unchanged", () => {
    const result = adaptProposal(BASE_FIXTURE);
    expect(result.id).toBe("proposal-001");
    expect(result.campaignGroupId).toBe("cg-abc");
    expect(result.status).toBe("awaiting_approval");
    expect(result.riskLevel).toBe("medium");
    expect(result.requestedChange).toEqual({ budget: 500 });
    expect(result.beforeState).toEqual({ budget: 300 });
    expect(result.expectedAfterState).toEqual({ budget: 500 });
    expect(result.appliedAfterState).toBeNull();
    expect(result.platformResponse).toBeNull();
    expect(result.rollbackGuidance).toBeNull();
  });

  it("maps snake_case keys to camelCase", () => {
    const raw = {
      id: "p-2",
      campaign_group_id: "cg-2",
      action_type: "campaign.pause",
      title: "Pause underperforming",
      status: "draft",
      risk_level: "low",
      risk_reasons: [],
      requires_strong_confirmation: false,
      before_state: { status: "active" },
      expected_after_state: { status: "paused" },
      applied_after_state: null,
      evidence_packet_id: null,
      approval_note: null,
      rejection_reason: null,
      approved_at: null,
      rejected_at: null,
      applying_at: null,
      applied_at: null,
      failed_at: null,
      expires_at: null,
      platform_response: null,
      error_details: null,
      rollback_guidance: null,
    };
    const result = adaptProposal(raw);
    expect(result.id).toBe("p-2");
    expect(result.campaignGroupId).toBe("cg-2");
    expect(result.actionType).toBe("campaign.pause");
    expect(result.riskLevel).toBe("low");
    expect(result.beforeState).toEqual({ status: "active" });
    expect(result.expectedAfterState).toEqual({ status: "paused" });
    expect(result.approvalNote).toBeNull();
    expect(result.platformResponse).toBeNull();
    expect(result.rollbackGuidance).toBeNull();
  });

  it("fills defaults for missing fields", () => {
    const raw = { id: "bare" };
    const result = adaptProposal(raw);
    expect(result.id).toBe("bare");
    expect(result.campaignGroupId).toBe("unknown-cg");
    expect(result.actionType).toBe("unknown");
    expect(result.status).toBe("draft");
    expect(result.riskLevel).toBe("low");
    expect(result.requestedChange).toBeNull();
    expect(result.beforeState).toBeNull();
    expect(result.expectedAfterState).toBeNull();
    expect(result.appliedAfterState).toBeNull();
    expect(result.platformResponse).toBeNull();
    expect(result.rollbackGuidance).toBeNull();
  });

  it("coerces riskReasons from various shapes", () => {
    expect(adaptProposal({ id: "a", riskReasons: ["reason 1"] }).riskReasons).toEqual(["reason 1"]);
    expect(adaptProposal({ id: "b", risk_reasons: ["snake"] }).riskReasons).toEqual(["snake"]);
    expect(adaptProposal({ id: "c" }).riskReasons).toEqual([]);
    expect(adaptProposal({ id: "d", riskReasons: null }).riskReasons).toEqual([]);
  });

  it("coerces null evidencePacketId to null", () => {
    const result = adaptProposal({
      id: "e1",
      evidencePacketId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.evidencePacketId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("tolerates extra unknown fields (passthrough)", () => {
    const raw = { id: "p", _internal: 42, extra_field: "ignored" };
    const result = adaptProposal(raw);
    expect(result.id).toBe("p");
    expect((result as Record<string, unknown>)._internal).toBeUndefined();
  });

  it("maps null target to null", () => {
    const result = adaptProposal({ ...BASE_FIXTURE, target: null });
    expect(result.target).toBeNull();
  });

  it("rejects invalid status through Zod validation", () => {
    expect(() => adaptProposal({ ...BASE_FIXTURE, status: "invalid_status" })).toThrow("status");
  });

  it("rejects invalid riskLevel through Zod validation", () => {
    expect(() => adaptProposal({ ...BASE_FIXTURE, riskLevel: "nuclear" })).toThrow("riskLevel");
  });

  it("treats null before/expected/applied states as null", () => {
    const result = adaptProposal({
      ...BASE_FIXTURE,
      beforeState: null,
      expectedAfterState: null,
      appliedAfterState: null,
    });
    expect(result.beforeState).toBeNull();
    expect(result.expectedAfterState).toBeNull();
    expect(result.appliedAfterState).toBeNull();
  });
});

describe("adaptProposalList", () => {
  it("adapts a plain array", () => {
    const result = adaptProposalList([BASE_FIXTURE, { ...BASE_FIXTURE, id: "p-2" }]);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("proposal-001");
    expect(result[1]!.id).toBe("p-2");
  });

  it("adapts from a 'data' envelope", () => {
    const result = adaptProposalList({ data: [BASE_FIXTURE] });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("proposal-001");
  });

  it("adapts from a 'proposals' envelope", () => {
    const result = adaptProposalList({ proposals: [BASE_FIXTURE] });
    expect(result).toHaveLength(1);
  });

  it("adapts from a 'rows' envelope", () => {
    const result = adaptProposalList({ rows: [BASE_FIXTURE] });
    expect(result).toHaveLength(1);
  });

  it("adapts from an 'items' envelope", () => {
    const result = adaptProposalList({ items: [BASE_FIXTURE] });
    expect(result).toHaveLength(1);
  });

  it("adapts from a 'results' envelope", () => {
    const result = adaptProposalList({ results: [BASE_FIXTURE] });
    expect(result).toHaveLength(1);
  });

  it("returns empty array for null", () => {
    expect(adaptProposalList(null)).toEqual([]);
  });

  it("returns empty array for empty object", () => {
    expect(adaptProposalList({})).toEqual([]);
  });

  it("returns empty array for object with non-array envelope", () => {
    expect(adaptProposalList({ data: "not-array" })).toEqual([]);
  });
});
