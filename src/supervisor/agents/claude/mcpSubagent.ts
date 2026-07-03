import {
  SUBAGENT_MCP_SERVER_NAME,
  type SubagentMcpHttpConfig,
} from "@/supervisor/agents/subagentMcp";

/**
 * Claude Agent SDK `mcpServers` entry shape for HTTP transport.
 * See @anthropic-ai/claude-agent-sdk's `McpHttpServerConfig`.
 *
 * Mirrors `claude/mcpBrowser.ts`. The subagents endpoint is delivered
 * pre-resolved via the launch input, so there is no location/WSL fallback here.
 */
interface ClaudeMcpServers {
  [name: string]: {
    type: "http";
    url: string;
    headers: Record<string, string>;
  };
}

export function buildClaudeSubagentMcpServers(
  enabled: boolean,
  subagentMcp?: SubagentMcpHttpConfig,
): ClaudeMcpServers | undefined {
  if (!enabled) return undefined;
  if (!subagentMcp) return undefined;
  return {
    [SUBAGENT_MCP_SERVER_NAME]: {
      type: "http",
      url: subagentMcp.url,
      headers: subagentMcp.headers,
    },
  };
}
