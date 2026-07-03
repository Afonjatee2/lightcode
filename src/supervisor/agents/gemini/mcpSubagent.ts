import {
  SUBAGENT_MCP_SERVER_NAME,
  type SubagentMcpHttpConfig,
} from "@/supervisor/agents/subagentMcp";
import type { GeminiMcpServers } from "./mcpBrowser";

/**
 * Gemini CLI `mcpServers` entry for the cross-provider subagents MCP.
 *
 * Mirrors `gemini/mcpBrowser.ts` (HTTP transport via `httpUrl` + verbatim
 * headers). The subagents endpoint is delivered pre-resolved via the launch
 * input, so — unlike the browser builder — there is no location/WSL fallback.
 */
export function buildGeminiSubagentMcpServers(
  subagentMcp?: SubagentMcpHttpConfig,
): GeminiMcpServers | undefined {
  if (!subagentMcp) return undefined;
  return {
    [SUBAGENT_MCP_SERVER_NAME]: {
      httpUrl: subagentMcp.url,
      headers: subagentMcp.headers,
      timeout: 30_000,
    },
  };
}
