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
 * OpenCode GUI is "launch": the structured session hosts the subagents MCP by
 * acquiring a DEDICATED per-thread `opencode serve` (pool key includes the
 * thread id) and registering the server dynamically via `client.mcp.add`
 * (mirroring the browser MCP), so the per-thread bearer token never touches the
 * GLOBAL `~/.config/opencode/opencode.json` (where it would be clobbered by the
 * next launch) nor a POOLED server shared by sibling threads (where it would
 * misattribute their spawns). The dedicated server dies with the thread. See
 * `opencode/sdkClient.ts` (`dedicatedKey` + `syncSubagentMcp`).
 *
 * OpenCode TUI stays "none": the terminal TUI reads the same global config, and
 * an always-present `{env:...}` template entry (the only per-process-gatable
 * shape, since OpenCode rejects a templated `enabled`) would pollute the GUI
 * shared-pool servers with a broken empty-URL `subagents` entry. OpenCode can
 * still be SPAWNED as a subagent — children run through the SDK session and the
 * run manager's recursion guard never sets `subagentMcp`.
 *
 * `antigravity`/`commandcode` GUI stay "none": no dedicated-server hosting path.
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
    if (baseKind === "opencode") return "launch";
    if (baseKind === "antigravity" || baseKind === "commandcode") return "none";
    return "launch";
  }
  if (baseKind === "codex") return "launch";
  return "none";
}
