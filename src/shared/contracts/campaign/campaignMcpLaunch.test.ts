import { describe, expect, it } from "vitest";
import type { McpServer } from "../mcpServer";
import {
  applyCampaignMcpProfile,
  CONTROL_CENTRE_MCP_PROFILE_ENV_VAR,
  CONTROL_CENTRE_MCP_PROFILE_HEADER,
} from "./campaignMcpLaunch";

function stdioServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "1",
    name: "control-centre",
    description: "",
    enabled: true,
    timeoutMs: 30_000,
    transport: { type: "stdio", command: "cc-mcp", args: [], env: {} },
    ...overrides,
  };
}

function httpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "1",
    name: "control-centre",
    description: "",
    enabled: true,
    timeoutMs: 30_000,
    transport: { type: "http", url: "https://cc.example.com/mcp", headers: {} },
    ...overrides,
  };
}

describe("applyCampaignMcpProfile", () => {
  it("injects the profile env var into a stdio control-centre server", () => {
    const [result] = applyCampaignMcpProfile([stdioServer()], "plan_revision");
    expect(result?.transport).toMatchObject({
      env: { [CONTROL_CENTRE_MCP_PROFILE_ENV_VAR]: "plan_revision" },
    });
  });

  it("does not inject headers for remote HTTP/SSE Control Centre servers (server-managed profile)", () => {
    const server = httpServer();
    const [result] = applyCampaignMcpProfile([server], "deployment");
    expect(result).toEqual(server);
    expect(result?.transport).not.toHaveProperty("headers." + CONTROL_CENTRE_MCP_PROFILE_HEADER);
  });

  it("defaults to monitoring when no profile is given", () => {
    const [result] = applyCampaignMcpProfile([stdioServer()]);
    expect(result?.transport).toMatchObject({
      env: { [CONTROL_CENTRE_MCP_PROFILE_ENV_VAR]: "monitoring" },
    });
  });

  it("leaves non-control-centre servers untouched", () => {
    const other = stdioServer({ id: "2", name: "some-other-server" });
    const [result] = applyCampaignMcpProfile([other], "deployment");
    expect(result).toEqual(other);
  });

  it("preserves existing env entries alongside the injected profile", () => {
    const server = stdioServer({
      transport: { type: "stdio", command: "cc-mcp", args: [], env: { API_KEY: "secret" } },
    });
    const [result] = applyCampaignMcpProfile([server], "client_comms");
    expect(result?.transport).toMatchObject({
      env: { API_KEY: "secret", [CONTROL_CENTRE_MCP_PROFILE_ENV_VAR]: "client_comms" },
    });
  });
});
