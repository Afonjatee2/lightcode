/**
 * Shared helper for injecting the Lightcode cross-provider subagents MCP server
 * into agent runtimes. The supervisor hosts a single in-process Streamable-HTTP
 * MCP endpoint (`SubagentMcpIngress`); each thread that opts in receives a URL +
 * per-thread bearer token at launch so the agent can discover and spawn the
 * other connected agents as subagents.
 *
 * Mirrors the `browserMcp` module shape. Each provider adapter (phase 2) reads
 * `CreateStructuredSessionInput.subagentMcp` / `AgentLaunchOptions.subagentMcp`
 * and assembles its provider-native MCP config (Claude SDK `mcpServers` http
 * entry, Codex `-c` overrides, Gemini `mcpServers` httpUrl, OpenCode `mcp`
 * remote, ACP `mcpServers` http variant).
 *
 * WSL rewriting is intentionally out of scope for the MVP — native only.
 */

export const SUBAGENT_MCP_SERVER_NAME = "subagents";

export interface SubagentMcpHttpConfig {
  /** MCP endpoint URL (already suffixed with `/mcp`). */
  url: string;
  /** Per-thread authorization bearer token. */
  token: string;
  /** Headers map (always includes `Authorization`). */
  headers: Record<string, string>;
}
