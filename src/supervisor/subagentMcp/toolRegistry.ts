import type { AgentKind, AgentStatus } from "@/shared/contracts";
import type { AgentAdapter } from "@/supervisor/agents/base";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
  SubagentSpawnError,
} from "./SubagentRunManager";
import type { SubagentRunManager } from "./SubagentRunManager";
import { resolveSubagentExecution } from "./types";
import type { McpToolResult, ModelTier, SpawnableAgent, SpawnAgentRequest } from "./types";

/** Shared `timeout_s` schema description for `wait_for_agent` and `run_agent`. */
const TIMEOUT_S_DESCRIPTION =
  'Max seconds to wait (capped at 240). On timeout, status is "running" — call wait_for_agent again to keep waiting.';

const FAST_CHEAP_KEYWORDS = ["haiku", "mini", "nano", "lite", "flash", "small", "spark", "fast"];
const MAX_CAPABILITY_KEYWORDS = ["opus", "fable", "pro", "max", "ultra", "big"];

/** Whether `keyword` appears in `haystack` as a whole word (not as a substring of a larger word). */
function hasWholeWordMatch(haystack: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`, "i").test(haystack);
}

/**
 * Classify a model into a coarse cost/capability tier from its id/label,
 * keyword-matched case-insensitively and provider-agnostic (no per-provider
 * special-casing). Matches whole words only, so e.g. "gemini" doesn't
 * false-positive on the "mini" keyword.
 */
export function classifyModelTier(modelId: string, modelLabel: string): ModelTier {
  const haystack = `${modelId} ${modelLabel}`;
  if (FAST_CHEAP_KEYWORDS.some((keyword) => hasWholeWordMatch(haystack, keyword)))
    return "fast-cheap";
  if (MAX_CAPABILITY_KEYWORDS.some((keyword) => hasWholeWordMatch(haystack, keyword)))
    return "max-capability";
  return "balanced";
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Base routing guidance always included in the MCP `initialize` instructions. */
export const SUBAGENT_MCP_INSTRUCTIONS_BASE = [
  "Use the subagents MCP server to delegate work to the other AI agents connected to this Lightcode session.",
  "Call list_agents first to see which agents and models are available.",
  "Routing: prefer fast/cheap agents+models for search, bulk edits, and summarization; reserve the strongest agents for implementation and review.",
  "Run independent tasks concurrently as parallel spawn_agent calls, then collect them with wait_for_agent.",
  "Use run_agent for a single blocking delegation; use spawn_agent + wait_for_agent for long tasks or fan-out.",
  "Give each subagent a self-contained prompt — it does not share your conversation context.",
].join(" ");

export function buildSubagentInstructions(routingGuide?: string): string {
  const guide = routingGuide?.trim();
  return guide ? `${SUBAGENT_MCP_INSTRUCTIONS_BASE}\n\n${guide}` : SUBAGENT_MCP_INSTRUCTIONS_BASE;
}

export const TOOLS: ToolSpec[] = [
  {
    name: "list_agents",
    description:
      "List the AI agents you can spawn as subagents, each with its available models and effort levels. Pick fast/cheap models for light tasks (search, summarization, bulk edits) and stronger models for implementation or review. Each model carries a tier hint: fast-cheap | balanced | max-capability. Each agent carries an execution lane: structured (full session) or one-shot (single prompt in, streamed text out; runs non-interactively with permissions bypassed — it cannot receive follow-up input, so put ALL context and instructions in the initial prompt).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "spawn_agent",
    description:
      "Start a subagent in the background and return its run_id immediately. Use with wait_for_agent for long tasks or to run several agents in parallel. Choose the smallest/fastest model that can do the job.",
    inputSchema: {
      type: "object",
      required: ["agent", "prompt"],
      properties: {
        agent: { type: "string", description: "Agent kind from list_agents." },
        model: {
          type: "string",
          description: "Model value from list_agents. Omit for the agent default.",
        },
        effort: { type: "string", description: "Optional effort/reasoning level." },
        prompt: { type: "string", description: "Self-contained task for the subagent." },
        name: { type: "string", description: "Optional short label for the run." },
      },
    },
  },
  {
    name: "wait_for_agent",
    description:
      "Block until a spawned subagent finishes (or the timeout elapses) and return its status and output.",
    inputSchema: {
      type: "object",
      required: ["run_id"],
      properties: {
        run_id: { type: "string" },
        timeout_s: {
          type: "number",
          description: TIMEOUT_S_DESCRIPTION,
        },
      },
    },
  },
  {
    name: "run_agent",
    description:
      'Spawn a subagent and block until it finishes, returning its status and output in one call. Prefer a fast/cheap model unless the task needs a stronger one. If it returns with status "running" (timeout), keep waiting via wait_for_agent or stop it via cancel using the returned run_id.',
    inputSchema: {
      type: "object",
      required: ["agent", "prompt"],
      properties: {
        agent: { type: "string", description: "Agent kind from list_agents." },
        model: {
          type: "string",
          description: "Model value from list_agents. Omit for the agent default.",
        },
        effort: { type: "string", description: "Optional effort/reasoning level." },
        prompt: { type: "string", description: "Self-contained task for the subagent." },
        name: { type: "string", description: "Optional short label for the run." },
        timeout_s: {
          type: "number",
          description: TIMEOUT_S_DESCRIPTION,
        },
      },
    },
  },
  {
    name: "get_status",
    description:
      "Check a spawned subagent without blocking: returns its current status and the output produced so far.",
    inputSchema: {
      type: "object",
      required: ["run_id"],
      properties: { run_id: { type: "string" } },
    },
  },
  {
    name: "cancel",
    description: "Interrupt and dispose a running subagent by run_id.",
    inputSchema: {
      type: "object",
      required: ["run_id"],
      properties: { run_id: { type: "string" } },
    },
  },
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export function isKnownToolName(name: string): boolean {
  return TOOL_NAMES.has(name);
}

/**
 * Build the spawnable-agent catalog from the adapter registry + agent statuses,
 * filtered to installed + authenticated providers the run manager can drive as a
 * child. An adapter qualifies via either lane:
 * - `structured`: implements `createStructuredSession` (full GUI runtime).
 * - `one-shot`: has no structured runtime but implements
 *   `buildSubagentOneShotCommand` (a bypass-permissions CLI invocation) — this
 *   pulls CLI-only providers (Antigravity, Command Code) into the roster.
 * The `execution` field is surfaced so calling agents can see which lane a child
 * uses (one-shot children stream a single result and can't be steered).
 */
export function buildSpawnableAgents(
  adapters: Map<AgentKind, AgentAdapter>,
  statuses: readonly AgentStatus[],
): SpawnableAgent[] {
  const out: SpawnableAgent[] = [];
  for (const status of statuses) {
    if (!status.installed || status.authState !== "authenticated") continue;
    const adapter = adapters.get(status.kind);
    if (!adapter) continue;
    const execution = resolveSubagentExecution(adapter);
    if (!execution) continue;
    const models = status.capabilities.models.map((m) => ({
      value: m.id,
      label: m.label,
      tier: classifyModelTier(m.id, m.label),
    }));
    if (models.length === 0) continue;
    const efforts = status.capabilities.efforts;
    const defaultModel = models[0]?.value;
    out.push({
      kind: status.kind,
      label: status.label,
      models,
      execution,
      ...(efforts.length > 0 ? { efforts } : {}),
      ...(defaultModel ? { defaultModel } : {}),
    });
  }
  return out;
}

export interface SubagentToolContext {
  parentThreadId: string;
  runManager: SubagentRunManager;
  listSpawnableAgents: () => Promise<SpawnableAgent[]>;
}

function jsonResult(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function parseSpawnRequest(args: Record<string, unknown>): SpawnAgentRequest {
  const agent = typeof args.agent === "string" ? args.agent : "";
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  if (!agent) throw new SubagentSpawnError("agent is required");
  if (!prompt.trim()) throw new SubagentSpawnError("prompt is required");
  return {
    agent,
    prompt,
    ...(typeof args.model === "string" ? { model: args.model } : {}),
    ...(typeof args.effort === "string" ? { effort: args.effort } : {}),
    ...(typeof args.name === "string" ? { name: args.name } : {}),
  };
}

/** Caller-supplied `timeout_s` → ms, clamped to [0, {@link MAX_WAIT_TIMEOUT_MS}]. */
function parseWaitTimeoutMs(value: unknown): number {
  const requestedMs =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, value * 1000)
      : DEFAULT_WAIT_TIMEOUT_MS;
  return Math.min(requestedMs, MAX_WAIT_TIMEOUT_MS);
}

/** Dispatch a tools/call. Never throws — validation failures return isError results. */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  ctx: SubagentToolContext,
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "list_agents":
        return jsonResult(await ctx.listSpawnableAgents());
      case "spawn_agent": {
        const request = parseSpawnRequest(args);
        const { runId } = ctx.runManager.spawn(ctx.parentThreadId, request);
        return jsonResult({ run_id: runId });
      }
      case "wait_for_agent": {
        const runId = typeof args.run_id === "string" ? args.run_id : "";
        if (!runId) return errorResult("run_id is required");
        return jsonResult(await ctx.runManager.waitFor(runId, parseWaitTimeoutMs(args.timeout_s)));
      }
      case "run_agent": {
        const request = parseSpawnRequest(args);
        const timeoutMs = parseWaitTimeoutMs(args.timeout_s);
        const { runId } = ctx.runManager.spawn(ctx.parentThreadId, request);
        const result = await ctx.runManager.waitFor(runId, timeoutMs);
        return jsonResult({ run_id: runId, ...result });
      }
      case "get_status": {
        const runId = typeof args.run_id === "string" ? args.run_id : "";
        if (!runId) return errorResult("run_id is required");
        return jsonResult(ctx.runManager.getStatus(runId));
      }
      case "cancel": {
        const runId = typeof args.run_id === "string" ? args.run_id : "";
        if (!runId) return errorResult("run_id is required");
        await ctx.runManager.cancel(runId);
        return jsonResult({ ok: true });
      }
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
