import {
  SUBAGENT_MCP_SERVER_NAME,
  type SubagentMcpHttpConfig,
} from "@/supervisor/agents/subagentMcp";
import type { AcpHttpMcpServer } from "./mcpBrowser";

/**
 * ACP `newSession`/`loadSession`/`resumeSession` accept an `mcpServers` array.
 * The HTTP variant in @agentclientprotocol/sdk is `McpServerHttp`:
 *   { type: "http", name, url, headers: HttpHeader[] }
 *
 * Mirrors `acp/mcpBrowser.ts`. The subagents endpoint is delivered pre-resolved
 * via the launch input, so there is no location/WSL fallback here. Returns the
 * array (possibly empty when MCP is disabled), so call sites can spread it
 * unconditionally.
 */
export function buildAcpSubagentMcpServers(
  enabled: boolean,
  subagentMcp?: SubagentMcpHttpConfig,
): AcpHttpMcpServer[] {
  if (!enabled) return [];
  if (!subagentMcp) return [];
  return [
    {
      type: "http",
      name: SUBAGENT_MCP_SERVER_NAME,
      url: subagentMcp.url,
      headers: Object.entries(subagentMcp.headers).map(([name, value]) => ({ name, value })),
    },
  ];
}
