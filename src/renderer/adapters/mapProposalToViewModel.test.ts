import { describe, expect, it } from "vitest";
import { mapProposalToViewModel } from "./mapProposalToViewModel";
import type { ControlCentreProposal } from "@/shared/campaignDeployment";

const identity = {
  campaignGroupId: "cg-1",
  campaignName: "Q3 Brand Burst",
  clientName: "AIB NI",
  jobNumber: "JOB-1",
  lifecycleStatus: "live",
};

function makeProposal(overrides: Partial<ControlCentreProposal> = {}): ControlCentreProposal {
  return {
    id: "prop-001",
    campaignGroupId: "cg-1",
    actionType: "adjust_budget",
    title: "Increase daily budget",
    summary: "Raise cap to capture afternoon peak.",
    status: "awaiting_approval",
    target: {
      platform: "google_ads",
      entityType: "campaign",
      entityId: "ga:123",
      entityName: "YT_Brand",
    },
    requestedChange: { dailyBudget: 600 },
    beforeState: { dailyBudget: 500 },
    expectedAfterState: { dailyBudget: 600 },
    appliedAfterState: null,
    evidencePacketId: "ev-1",
    riskLevel: "high",
    riskReasons: ["Budget delta exceeds threshold"],
    requiresStrongConfirmation: true,
    approvalNote: null,
    rejectionReason: null,
    approvedAt: null,
    rejectedAt: null,
    applyingAt: null,
    appliedAt: null,
    failedAt: null,
    expiresAt: "2026-08-01T00:00:00Z",
    createdAt: "2026-07-22T08:00:00Z",
    platformResponse: null,
    errorDetails: null,
    rollbackGuidance: null,
    ...overrides,
  };
}

describe("mapProposalToViewModel", () => {
  it("maps identity, risk, and field-level changes from a normalised proposal", () => {
    const vm = mapProposalToViewModel(makeProposal(), identity);

    expect(vm.id).toBe("prop-001");
    expect(vm.clientName).toBe("AIB NI");
    expect(vm.campaignName).toBe("Q3 Brand Burst");
    expect(vm.risk.level).toBe("high");
    expect(vm.risk.requiresStrongConfirmation).toBe(true);
    expect(vm.fieldChanges).toEqual([
      expect.objectContaining({
        field: "dailyBudget",
        currentValue: 500,
        proposedValue: 600,
      }),
    ]);
    expect(vm.evidence.packetId).toBe("ev-1");
    expect(vm.status).toBe("awaiting_approval");
  });

  it("maps applied outcome from server status", () => {
    const vm = mapProposalToViewModel(
      makeProposal({
        status: "applied",
        appliedAt: "2026-07-22T11:05:00Z",
        platformResponse: { summary: "Budget updated" },
      }),
      identity,
    );

    expect(vm.applyResult?.outcome).toBe("applied");
    expect(vm.applyResult?.platformResponse).toBe("Budget updated");
  });
});
