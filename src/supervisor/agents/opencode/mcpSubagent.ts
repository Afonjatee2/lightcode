import {
  SUBAGENT_MCP_SERVER_NAME,
  type SubagentMcpHttpConfig,
} from "@/supervisor/agents/subagentMcp";
import type { OpenCodeMcpServers } from "./mcpBrowser";

/**
 * OpenCode `opencode.json` `mcp` entry for the cross-provider subagents MCP —
 * remote (Streamable-HTTP) variant.
 *
 * Mirrors `opencode/mcpBrowser.ts`. The subagents endpoint is delivered
 * pre-resolved via the launch input, so — unlike the browser builder — there is
 * no location/WSL fallback.
 */
export function buildOpenCodeSubagentMcp(
  subagentMcp?: SubagentMcpHttpConfig,
): OpenCodeMcpServers | undefined {
  if (!subagentMcp) return undefined;
  return {
    [SUBAGENT_MCP_SERVER_NAME]: {
      type: "remote",
      url: subagentMcp.url,
      headers: subagentMcp.headers,
      enabled: true,
    },
  };
}
