import { describe, expect, it } from "vitest";
import { buildAcpSubagentMcpServers } from "../acp/mcpSubagent";
import { buildClaudeSubagentMcpServers } from "../claude/mcpSubagent";
import {
  buildCodexSubagentMcpArgs,
  buildCodexSubagentMcpEnv,
  CODEX_SUBAGENT_MCP_TOKEN_ENV,
} from "../codex/mcpSubagent";
import type { SubagentMcpHttpConfig } from "./index";

const cfg: SubagentMcpHttpConfig = {
  url: "http://127.0.0.1:9200/mcp",
  token: "subagent-token",
  headers: { Authorization: "Bearer subagent-token" },
};

describe("Subagent MCP provider configs", () => {
  it("builds the same endpoint shape for every provider when enabled", () => {
    expect(buildAcpSubagentMcpServers(true, cfg)).toEqual([
      {
        type: "http",
        name: "subagents",
        url: cfg.url,
        headers: [{ name: "Authorization", value: "Bearer subagent-token" }],
      },
    ]);
    expect(buildClaudeSubagentMcpServers(true, cfg)).toEqual({
      subagents: {
        type: "http",
        url: cfg.url,
        headers: cfg.headers,
      },
    });
    expect(buildCodexSubagentMcpArgs(true, cfg)).toEqual([
      "-c",
      "experimental_use_rmcp_client=true",
      "-c",
      'mcp_servers.subagents.url="http://127.0.0.1:9200/mcp"',
      "-c",
      'mcp_servers.subagents.bearer_token_env_var="LIGHTCODE_SUBAGENT_MCP_TOKEN"',
    ]);
    expect(buildCodexSubagentMcpEnv(cfg)).toEqual({
      [CODEX_SUBAGENT_MCP_TOKEN_ENV]: "subagent-token",
    });
  });

  it("uses a token env var distinct from the browser MCP one", () => {
    expect(CODEX_SUBAGENT_MCP_TOKEN_ENV).toBe("LIGHTCODE_SUBAGENT_MCP_TOKEN");
    expect(CODEX_SUBAGENT_MCP_TOKEN_ENV).not.toBe("LIGHTCODE_BROWSER_MCP_TOKEN");
  });

  it("emits nothing when disabled", () => {
    expect(buildAcpSubagentMcpServers(false, cfg)).toEqual([]);
    expect(buildClaudeSubagentMcpServers(false, cfg)).toBeUndefined();
    expect(buildCodexSubagentMcpArgs(false, cfg)).toEqual([]);
  });

  it("emits nothing when enabled but no config is present", () => {
    expect(buildAcpSubagentMcpServers(true)).toEqual([]);
    expect(buildClaudeSubagentMcpServers(true)).toBeUndefined();
    expect(buildCodexSubagentMcpArgs(true)).toEqual([]);
    expect(buildCodexSubagentMcpEnv(undefined)).toBeUndefined();
  });
});
