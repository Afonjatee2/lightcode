import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlCentreDeploymentClient } from "@/shared/campaignDeployment";
import { useDeploymentClient } from "./useDeploymentClient";

const mocks = vi.hoisted(() => ({
  resolveControlCentreServer: vi.fn<() => unknown>(),
  callDeploymentMcpTool: vi.fn<() => Promise<unknown>>(),
  useProject: vi.fn<() => unknown>(),
  useSharedSettings: vi.fn<(selector: (s: { mcpServers: [] }) => unknown) => unknown>(),
}));

vi.mock("@/renderer/hooks/useControlCentreTool", () => ({
  resolveControlCentreServer: mocks.resolveControlCentreServer,
}));

vi.mock("./callDeploymentMcpTool", () => ({
  callDeploymentMcpTool: mocks.callDeploymentMcpTool,
}));

vi.mock("@/renderer/state/useThread", () => ({
  useProject: mocks.useProject,
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: mocks.useSharedSettings,
}));

describe("useDeploymentClient approve flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useProject.mockReturnValue({
      id: "project-1",
      location: { kind: "posix", path: "/repo" },
    });
    mocks.useSharedSettings.mockImplementation((selector: (s: { mcpServers: [] }) => unknown) =>
      selector({ mcpServers: [] }),
    );
    mocks.resolveControlCentreServer.mockReturnValue({
      id: "cc-1",
      name: "control-centre",
      enabled: true,
      transport: { type: "http", url: "https://cc.example.com/mcp", headers: {} },
    });
  });

  it("dispatches approve_action_proposal through the MCP transport", async () => {
    mocks.callDeploymentMcpTool.mockResolvedValue({
      id: "p-1",
      campaignGroupId: "cg-1",
      actionType: "budget.update",
      title: "Approve me",
      status: "approved",
      riskLevel: "low",
    });

    const { result } = renderHook(() => useDeploymentClient("project-1", "cg-1"));
    const client = result.current as ControlCentreDeploymentClient;
    expect(client).not.toBeNull();

    await client.approveProposal({ id: "p-1", approvalNote: "Looks good" });

    expect(mocks.callDeploymentMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "approve_action_proposal",
        args: { id: "p-1", approvalNote: "Looks good" },
      }),
    );
  });

  it("returns null when no Control Centre server is configured", async () => {
    mocks.resolveControlCentreServer.mockReturnValue(undefined);
    const { result } = renderHook(() => useDeploymentClient("project-1", "cg-1"));
    await waitFor(() => expect(result.current).toBeNull());
  });
});
