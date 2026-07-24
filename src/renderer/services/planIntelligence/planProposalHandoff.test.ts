import { describe, expect, it, vi } from "vitest";
import { planIntelligenceProposeFixture } from "@/shared/contracts/campaign/fixtures/planIntelligenceCompare.fixture";
import { proposePlanUpdates } from "./runPlanCompareFlow";

const mocks = vi.hoisted(() => ({
  callPlanIntelligenceMcpTool: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("./planIntelligenceClient", () => ({
  callPlanIntelligenceMcpTool: mocks.callPlanIntelligenceMcpTool,
}));

describe("plan proposal hand-off", () => {
  it("dispatches propose_plan_updates through the Control Centre MCP bridge", async () => {
    mocks.callPlanIntelligenceMcpTool.mockResolvedValue(planIntelligenceProposeFixture);

    const result = await proposePlanUpdates({
      context: {
        server: {
          id: "cc-1",
          name: "control-centre",
          description: "",
          enabled: true,
          timeoutMs: 30_000,
          transport: { type: "http", url: "https://cc.example.com/mcp", headers: {} },
        },
        campaignGroupId: "group-1",
      },
      candidatePlanId: "pv-revised-v2",
      basePlanId: "pv-published-v6",
      allowLowConfidence: true,
    });

    expect(mocks.callPlanIntelligenceMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "propose_plan_updates",
        args: {
          candidatePlanId: "pv-revised-v2",
          basePlanVersionId: "pv-published-v6",
          allowLowConfidence: true,
        },
      }),
    );
    expect(result.proposal.id).toBe("proposal-plan-replace-1");
    expect(result.proposal.status).toBe("awaiting_approval");
  });
});
