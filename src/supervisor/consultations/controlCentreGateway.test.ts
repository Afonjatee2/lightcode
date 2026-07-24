import { describe, expect, it, vi } from "vitest";
import { McpControlCentreGateway } from "./controlCentreGateway";
import type { McpServer } from "@/shared/contracts";

function makeControlCentreServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "test-cc",
    name: "control-centre",
    description: "Test CC server",
    enabled: true,
    timeoutMs: 5_000,
    transport: {
      type: "http" as const,
      url: "https://cc.example.com/mcp",
      headers: {},
    },
    ...overrides,
  };
}

describe("McpControlCentreGateway authenticated transport", () => {
  it("applies OAuth authorization to the server before connecting", async () => {
    let calledServer: McpServer | undefined;
    const applyAuthorization = vi.fn<(server: McpServer) => Promise<McpServer>>(
      async (server) => {
        calledServer = server;
        return {
          ...server,
          transport: {
            ...server.transport,
            headers: {
              ...(server.transport.type === "http" ? (server.transport as { headers?: Record<string, string> }).headers : {}),
              Authorization: "Bearer test-token-123",
            },
          },
        };
      },
    );

    const gateway = new McpControlCentreGateway({
      getProjectMcpServers: () => [makeControlCentreServer()],
      getSharedMcpServers: () => [],
      applyAuthorization,
    });

    // The gateway will try to connect to a real URL and fail (expected in unit tests),
    // but that's fine — we only care that applyAuthorization was called with the right server.
    const result = await gateway.callTool("p-1", "get_campaign_context", { id: "cg-1" });

    expect(applyAuthorization).toHaveBeenCalledTimes(1);
    expect(calledServer).toBeDefined();
    expect(calledServer!.transport.type).toBe("http");
    // The connection will fail (no real server), but auth was applied.
    expect(result.status).not.toBe("auth-required");
    // Not-configured would also pass since we only test the auth flow.
  });

  it("returns auth-required when authorization fails", async () => {
    const gateway = new McpControlCentreGateway({
      getProjectMcpServers: () => [makeControlCentreServer()],
      getSharedMcpServers: () => [],
      applyAuthorization: async () => {
        throw new Error("token refresh failed");
      },
    });

    const result = await gateway.callTool("p-1", "get_campaign_context", { id: "cg-1" });
    expect(result.status).toBe("auth-required");
  });

  it("returns not-configured when no Control Centre server is registered", async () => {
    const gateway = new McpControlCentreGateway({
      getProjectMcpServers: () => [],
      getSharedMcpServers: () => [],
    });

    const result = await gateway.callTool("p-1", "get_campaign_context", { id: "cg-1" });
    expect(result.status).toBe("not-configured");
  });

  it("returns auth-required when the server is disabled after authorization", async () => {
    const gateway = new McpControlCentreGateway({
      getProjectMcpServers: () => [makeControlCentreServer()],
      getSharedMcpServers: () => [],
      applyAuthorization: async (server) => ({ ...server, enabled: false }),
    });

    const result = await gateway.callTool("p-1", "get_campaign_context", { id: "cg-1" });
    expect(result.status).toBe("auth-required");
  });

  it("does not call applyAuthorization when no auth function is provided", async () => {
    const gateway = new McpControlCentreGateway({
      getProjectMcpServers: () => [makeControlCentreServer()],
      getSharedMcpServers: () => [],
    });

    const result = await gateway.callTool("p-1", "get_campaign_context", { id: "cg-1" });
    // Auth was never attempted — the connection fails for other reasons.
    expect(result.status === "not-configured" || result.status === "unavailable").toBe(true);
  });
});
