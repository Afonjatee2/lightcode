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
 *              Gemini TUI / OpenCode TUI: install-time / launch-time global
 *              config).
 *
 * Mapping is kept identical to `browserMcpScope.ts` so the Subagents badge
 * appears in exactly the same surfaces as the Browser badge.
 *
 * OpenCode is "none" and cannot host per-thread MCP at all: its config file
 * is GLOBAL (`~/.config/opencode/opencode.json`) and its GUI server is pooled
 * per project, so a per-thread bearer token written there would be
 * overwritten/deleted by the next OpenCode launch and could attribute one
 * thread's subagent spawns to another thread. The browser MCP tolerates this
 * only because its token is app-global. OpenCode can still be SPAWNED as a
 * subagent — children are driven through the SDK session directly and don't
 * need the config file.
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
    if (baseKind === "opencode" || baseKind === "antigravity" || baseKind === "commandcode")
      return "none";
    return "launch";
  }
  if (baseKind === "codex") return "launch";
  return "none";
}
