import { describe, expect, it, vi } from "vitest";
import { createMcpDeploymentTransport } from "./mcpDeploymentTransport";

describe("createMcpDeploymentTransport", () => {
  it("maps list proposals GET to list_pending_action_proposals", async () => {
    const callTool = vi.fn<() => Promise<unknown>>().mockResolvedValue({ proposals: [] });
    const transport = createMcpDeploymentTransport(callTool);

    await transport.get("/campaign-groups/cg-1/action-proposals?status=awaiting_approval");

    expect(callTool).toHaveBeenCalledWith("list_pending_action_proposals", {
      campaignGroupId: "cg-1",
      status: "awaiting_approval",
    });
  });

  it("maps get proposal GET to get_action_proposal", async () => {
    const callTool = vi.fn<() => Promise<unknown>>().mockResolvedValue({ id: "p-1" });
    const transport = createMcpDeploymentTransport(callTool);

    await transport.get("/action-proposals/p-1");

    expect(callTool).toHaveBeenCalledWith("get_action_proposal", { id: "p-1" });
  });

  it("maps approve POST to approve_action_proposal", async () => {
    const callTool = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ id: "p-1", status: "approved" });
    const transport = createMcpDeploymentTransport(callTool);

    await transport.post("/action-proposals/p-1/approve", {
      approvalNote: "ok",
      strongConfirmation: "APPROVE",
    });

    expect(callTool).toHaveBeenCalledWith("approve_action_proposal", {
      id: "p-1",
      approvalNote: "ok",
      strongConfirmation: "APPROVE",
    });
  });

  it("maps reject POST to reject_action_proposal", async () => {
    const callTool = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ id: "p-1", status: "rejected" });
    const transport = createMcpDeploymentTransport(callTool);

    await transport.post("/action-proposals/p-1/reject", { rejectionReason: "nope" });

    expect(callTool).toHaveBeenCalledWith("reject_action_proposal", {
      id: "p-1",
      rejectionReason: "nope",
    });
  });
});
