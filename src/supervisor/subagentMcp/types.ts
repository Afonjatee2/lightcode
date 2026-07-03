import type { ProjectLocation, RuntimeEvent, ThreadConfig } from "@/shared/contracts";

/** Terminal states a subagent run can settle into. */
export type SubagentRunStatus = "running" | "completed" | "failed" | "cancelled";

/** A model choice offered to the calling agent for a spawnable agent. */
export interface SpawnableAgentModel {
  value: string;
  label: string;
}

/**
 * A connected agent the caller can spawn as a subagent. Sourced from the agent
 * status service + adapter registry, filtered to installed + authenticated
 * providers whose adapter implements `createStructuredSession`.
 */
export interface SpawnableAgent {
  kind: string;
  label: string;
  models: SpawnableAgentModel[];
  efforts?: string[];
  defaultModel?: string;
}

/** Arguments accepted by `spawn_agent` / `run_agent`. */
export interface SpawnAgentRequest {
  agent: string;
  model?: string;
  effort?: string;
  prompt: string;
  name?: string;
}

/** Result of `wait_for_agent` / `run_agent`. */
export interface SubagentWaitResult {
  status: SubagentRunStatus;
  output: string;
}

/**
 * Host surface the run manager needs from the supervisor's thread session
 * manager. Kept minimal so the TSM only exposes thin hooks (no-god-files).
 */
export interface SubagentRunHost {
  /** Resolve a live parent thread's project location + config for child inheritance. */
  getParentContext(
    threadId: string,
  ): { projectLocation: ProjectLocation; config: ThreadConfig } | undefined;
  /** Append a (re-tagged) runtime event into the parent thread's event stream. */
  appendRuntimeEvent(parentThreadId: string, event: RuntimeEvent): void;
}

/** MCP tool result content shape. */
export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}
