import { baseAgentKind, type ThreadPresentationMode } from "@/shared/contracts";

/**
 * How a given (agentKind, presentationMode) pair gates the cross-provider
 * subagents MCP per-thread. Mirrors `browserMcpScope.ts`:
 *
 * - "always":  the MCP server set is rebuilt on every turn (Claude SDK GUI).
 *              Badge is toggleable mid-thread.
 * - "launch":  the MCP server set is baked in at thread/session start
 *              (Codex `-c` argv, ACP `newSession.mcpServers`). Badge controls
 *              launch; once running it is read-only.
 * - "none":    no per-thread gating point exists (Claude TUI: no MCP wired;
 *              Gemini / OpenCode: not wired in this phase).
 *
 * Source of truth: `src/supervisor/agents/*\/mcpSubagent.ts` and their callers.
 */
export type SubagentMcpScope = "none" | "launch" | "always";

export function getSubagentMcpScope(
  agentKind: string,
  presentationMode: ThreadPresentationMode,
): SubagentMcpScope {
  const baseKind = baseAgentKind(agentKind);
  if (presentationMode === "gui") {
    if (baseKind === "claude") return "always";
    if (
      baseKind === "gemini" ||
      baseKind === "opencode" ||
      baseKind === "antigravity" ||
      baseKind === "commandcode"
    )
      return "none";
    return "launch";
  }
  if (baseKind === "codex") return "launch";
  return "none";
}
