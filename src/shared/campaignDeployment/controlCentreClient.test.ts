import { describe, expect, it, beforeEach } from "vitest";
import { FixtureDeploymentClient } from "./controlCentreClient";
import type { ControlCentreProposal } from "./types";

function makeProposal(overrides: Partial<ControlCentreProposal> = {}): ControlCentreProposal {
  return {
    id: "proposal-001",
    campaignGroupId: "cg-abc",
    actionType: "budget.update",
    title: "Increase daily budget",
    summary: null,
    status: "awaiting_approval",
    target: null,
    requestedChange: { budget: 500 },
    beforeState: { budget: 300 },
    expectedAfterState: { budget: 500 },
    appliedAfterState: null,
    evidencePacketId: null,
    riskLevel: "low",
    riskReasons: [],
    requiresStrongConfirmation: false,
    idempotencyKey: "idem-001",
    approvalNote: null,
    rejectionReason: null,
    approvedAt: null,
    rejectedAt: null,
    applyingAt: null,
    appliedAt: null,
    failedAt: null,
    expiresAt: null,
    createdAt: null,
    platformResponse: null,
    errorDetails: null,
    rollbackGuidance: null,
    ...overrides,
  };
}

describe("FixtureDeploymentClient", () => {
  let client: FixtureDeploymentClient;

  beforeEach(() => {
    client = new FixtureDeploymentClient([
      makeProposal({ id: "p-1", campaignGroupId: "cg-a", status: "awaiting_approval" }),
      makeProposal({ id: "p-2", campaignGroupId: "cg-a", status: "draft" }),
      makeProposal({ id: "p-3", campaignGroupId: "cg-b", status: "awaiting_approval" }),
      makeProposal({
        id: "p-high",
        campaignGroupId: "cg-a",
        status: "awaiting_approval",
        riskLevel: "high",
        requiresStrongConfirmation: true,
      }),
    ]);
  });

  describe("listProposals", () => {
    it("returns proposals for a campaign group", async () => {
      const results = await client.listProposals({ campaignGroupId: "cg-a" });
      expect(results).toHaveLength(3);
    });

    it("filters by status", async () => {
      const results = await client.listProposals({
        campaignGroupId: "cg-a",
        status: "draft",
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("p-2");
    });

    it("returns empty for unknown campaign group", async () => {
      const results = await client.listProposals({ campaignGroupId: "cg-unknown" });
      expect(results).toEqual([]);
    });
  });

  describe("getProposal", () => {
    it("returns a proposal by id", async () => {
      const p = await client.getProposal("p-1");
      expect(p.id).toBe("p-1");
    });

    it("throws for unknown id", async () => {
      await expect(client.getProposal("unknown")).rejects.toThrow("Proposal unknown not found");
    });
  });

  describe("refreshProposal", () => {
    it("re-fetches by id", async () => {
      const p = await client.refreshProposal("p-1");
      expect(p.id).toBe("p-1");
    });
  });

  describe("approveProposal", () => {
    it("approves a pending proposal", async () => {
      const p = await client.approveProposal({
        id: "p-1",
        approvalNote: "Looks good",
      });
      expect(p.status).toBe("approved");
      expect(p.approvalNote).toBe("Looks good");
      expect(p.approvedAt).toBeTruthy();
    });

    it("throws when approving non-pending proposal", async () => {
      await expect(client.approveProposal({ id: "p-2" })).rejects.toThrow(
        "Cannot approve proposal in status: draft",
      );
    });

    it("throws when strong confirmation missing for high-risk", async () => {
      await expect(client.approveProposal({ id: "p-high" })).rejects.toThrow(
        "Strong confirmation required for high-risk proposal",
      );
    });

    it("approves high-risk when strong confirmation provided", async () => {
      const p = await client.approveProposal({
        id: "p-high",
        strongConfirmation: "confirmed",
      });
      expect(p.status).toBe("approved");
    });

    it("throws for unknown proposal", async () => {
      await expect(client.approveProposal({ id: "unknown" })).rejects.toThrow(
        "Proposal unknown not found",
      );
    });
  });

  describe("rejectProposal", () => {
    it("rejects a pending proposal with reason", async () => {
      const p = await client.rejectProposal({
        id: "p-1",
        rejectionReason: "Budget too high",
      });
      expect(p.status).toBe("rejected");
      expect(p.rejectionReason).toBe("Budget too high");
      expect(p.rejectedAt).toBeTruthy();
    });

    it("rejects a pending proposal without a reason", async () => {
      const p = await client.rejectProposal({ id: "p-1" });
      expect(p.status).toBe("rejected");
      expect(p.rejectionReason).toBeNull();
      expect(p.rejectedAt).toBeTruthy();
    });

    it("throws when rejecting non-pending proposal", async () => {
      await expect(client.rejectProposal({ id: "p-2", rejectionReason: "nope" })).rejects.toThrow(
        "Cannot reject proposal in status: draft",
      );
    });

    it("throws for unknown proposal", async () => {
      await expect(
        client.rejectProposal({ id: "unknown", rejectionReason: "nope" }),
      ).rejects.toThrow("Proposal unknown not found");
    });
  });

  describe("seed", () => {
    it("replaces all proposals", async () => {
      client.seed([makeProposal({ id: "fresh", campaignGroupId: "cg-z" })]);
      const results = await client.listProposals({ campaignGroupId: "cg-z" });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("fresh");

      // Old proposals are gone
      await expect(client.getProposal("p-1")).rejects.toThrow("Proposal p-1 not found");
    });
  });

  describe("no direct platform-write path", () => {
    it("does not expose an apply method", () => {
      // TypeScript compile-time check: the interface has no apply/execute/write
      expect("applyProposal" in client).toBe(false);
      expect("executeProposal" in client).toBe(false);
      expect((client as unknown as Record<string, unknown>).applyProposal).toBeUndefined();
      expect((client as unknown as Record<string, unknown>).executeProposal).toBeUndefined();
    });

    it("does not mark approved proposals as applied", async () => {
      const p = await client.approveProposal({ id: "p-1" });
      expect(p.status).toBe("approved");
      // appliedAt must come from Control Centre server, never set locally
      expect(p.appliedAt).toBeNull();
      expect(p.status).not.toBe("applied");
      expect(p.status).not.toBe("applying");
    });
  });
});
