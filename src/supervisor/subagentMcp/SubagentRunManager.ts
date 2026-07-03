import { randomBytes } from "node:crypto";
import type {
  AgentKind,
  ProjectLocation,
  RuntimeEvent,
  ThreadConfig,
  ToolCallPayload,
} from "@/shared/contracts";
import type { AgentAdapter, StructuredSessionHandle } from "@/supervisor/agents/base";
import type {
  SpawnAgentRequest,
  SubagentRunHost,
  SubagentRunStatus,
  SubagentWaitResult,
} from "./types";

/** Default `wait_for_agent` / `run_agent` blocking timeout. */
export const DEFAULT_WAIT_TIMEOUT_MS = 600_000;
/** Max concurrent live children per parent thread. */
export const MAX_CONCURRENT_CHILDREN_PER_PARENT = 4;

export interface SubagentRunManagerDeps {
  adapters: Map<AgentKind, AgentAdapter>;
  host: SubagentRunHost;
}

interface RunRecord {
  runId: string;
  parentThreadId: string;
  childThreadId: string;
  label: string;
  status: SubagentRunStatus;
  /** Accumulated assistant text from `content.delta` events. */
  output: string;
  handle: StructuredSessionHandle | undefined;
  cancelRequested: boolean;
  settled: boolean;
  settledPromise: Promise<void>;
  resolveSettled: () => void;
}

/** A synchronous spawn-time failure surfaced to the caller as an MCP error. */
export class SubagentSpawnError extends Error {}

/** Prefix used for a child's re-tagged item ids inside the parent stream. */
function childItemPrefix(runId: string): string {
  return `${runId}:`;
}

/** Synthetic parent tool_call item id that hosts the subagent's child items. */
function syntheticItemId(runId: string): string {
  return `sub:${runId}`;
}

/**
 * Owns cross-provider subagent child runs. Each child is a real provider
 * structured session created directly from the adapter registry (NOT a
 * thread-store thread), whose item-level runtime events are re-tagged and
 * merged into the spawning parent thread's stream under a synthetic sub-agent
 * tool_call tile.
 */
export class SubagentRunManager {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly deps: SubagentRunManagerDeps) {}

  /**
   * Kick off a child run. Validates synchronously (adapter, parent, capacity)
   * — throwing {@link SubagentSpawnError} on failure — then creates the child
   * session and starts its turn asynchronously. Returns immediately with the
   * run id.
   */
  spawn(parentThreadId: string, request: SpawnAgentRequest): { runId: string } {
    const prompt = request.prompt?.trim();
    if (!prompt) {
      throw new SubagentSpawnError("prompt is required");
    }
    const adapter = this.deps.adapters.get(request.agent as AgentKind);
    if (!adapter) {
      throw new SubagentSpawnError(`Unknown agent: ${request.agent}`);
    }
    if (!adapter.createStructuredSession) {
      throw new SubagentSpawnError(`Agent ${request.agent} cannot be spawned as a subagent`);
    }
    const parent = this.deps.host.getParentContext(parentThreadId);
    if (!parent) {
      throw new SubagentSpawnError("Parent thread is no longer active");
    }
    if (this.activeCountForParent(parentThreadId) >= MAX_CONCURRENT_CHILDREN_PER_PARENT) {
      throw new SubagentSpawnError(
        `Too many concurrent subagents (max ${MAX_CONCURRENT_CHILDREN_PER_PARENT}). Wait for one to finish or cancel it.`,
      );
    }

    const model = request.model ?? adapter.capabilities.models[0]?.id;
    if (!model) {
      throw new SubagentSpawnError(`Agent ${request.agent} has no available models`);
    }
    const modelLabel = adapter.capabilities.models.find((m) => m.id === model)?.label ?? model;
    const runName = request.name?.trim();
    const label = runName
      ? `${runName} — ${adapter.label} · ${modelLabel}`
      : `${adapter.label} · ${modelLabel}`;

    const runId = randomBytes(6).toString("hex");
    const childThreadId = `${parentThreadId}::sub::${runId}`;

    // Child config inherits the parent's approval/sandbox posture but never
    // carries subagentMcp/browserMcp — the recursion guard: children can't
    // spawn grandchildren.
    const childConfig: ThreadConfig = {
      model,
      ...(request.effort ? { effort: request.effort } : {}),
      ...(parent.config.approvalPolicy ? { approvalPolicy: parent.config.approvalPolicy } : {}),
      ...(parent.config.sandboxMode ? { sandboxMode: parent.config.sandboxMode } : {}),
    };

    let resolveSettled!: () => void;
    const settledPromise = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const record: RunRecord = {
      runId,
      parentThreadId,
      childThreadId,
      label,
      status: "running",
      output: "",
      handle: undefined,
      cancelRequested: false,
      settled: false,
      settledPromise,
      resolveSettled,
    };
    this.runs.set(runId, record);

    // Emit the synthetic parent tile so the existing subagent renderer picks it
    // up (renderer keys on payload.isSubAgent === true).
    const startPayload: ToolCallPayload = { name: label, status: "running", isSubAgent: true };
    this.deps.host.appendRuntimeEvent(parentThreadId, {
      type: "item.started",
      threadId: parentThreadId,
      itemId: syntheticItemId(runId),
      itemType: "tool_call",
      payload: startPayload,
    });

    void this.runChild(record, adapter, parent.projectLocation, childConfig, prompt);

    return { runId };
  }

  /** Block until the run settles or the timeout elapses. */
  async waitFor(runId: string, timeoutMs: number): Promise<SubagentWaitResult> {
    const record = this.runs.get(runId);
    if (!record) {
      return { status: "failed", output: `Unknown run_id: ${runId}` };
    }
    if (record.status !== "running") {
      return { status: record.status, output: record.output };
    }
    const timedOut = Symbol("timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      record.settledPromise.then(() => "settled" as const),
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), Math.max(0, timeoutMs));
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (result === timedOut) {
      return { status: "running", output: record.output };
    }
    return { status: record.status, output: record.output };
  }

  getStatus(runId: string): SubagentWaitResult {
    const record = this.runs.get(runId);
    if (!record) return { status: "failed", output: `Unknown run_id: ${runId}` };
    return { status: record.status, output: record.output };
  }

  /** Interrupt + dispose a single run. */
  async cancel(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) return;
    record.cancelRequested = true;
    await this.teardown(record);
    this.settle(record, "cancelled");
  }

  /**
   * Cancel every live child of a parent and evict all of its run records.
   * Called on parent thread interrupt and close.
   */
  cancelAllForThread(parentThreadId: string): void {
    for (const record of [...this.runs.values()]) {
      if (record.parentThreadId !== parentThreadId) continue;
      record.cancelRequested = true;
      this.settle(record, "cancelled");
      this.runs.delete(record.runId);
    }
  }

  private activeCountForParent(parentThreadId: string): number {
    let count = 0;
    for (const record of this.runs.values()) {
      if (record.parentThreadId === parentThreadId && record.status === "running") count += 1;
    }
    return count;
  }

  private async runChild(
    record: RunRecord,
    adapter: AgentAdapter,
    projectLocation: ProjectLocation,
    childConfig: ThreadConfig,
    prompt: string,
  ): Promise<void> {
    try {
      const handle = await adapter.createStructuredSession?.({
        threadId: record.childThreadId,
        projectLocation,
        config: childConfig,
        presentationMode: "gui",
      });
      if (!handle) {
        this.settle(record, "failed", "Failed to create subagent session");
        return;
      }
      record.handle = handle;
      if (record.cancelRequested) {
        this.settle(record, "cancelled");
        return;
      }
      handle.setListener({
        onClose: () => this.settle(record, "completed"),
        onError: (message) => this.settle(record, "failed", message),
        onUpdate: () => {},
        onRuntimeEvent: (event) => this.onChildEvent(record, event),
      });

      if (handle.activate) await handle.activate();
      if (record.cancelRequested) return void this.settle(record, "cancelled");
      if (handle.openThread) await handle.openThread(childConfig);
      if (record.cancelRequested) return void this.settle(record, "cancelled");
      if (handle.startTurn) await handle.startTurn(prompt, childConfig);
    } catch (error) {
      this.settle(
        record,
        record.cancelRequested ? "cancelled" : "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Consume a child event: accumulate assistant output, drive lifecycle from
   * turn completion, and forward only item-level events onto the parent stream.
   * Turn/session/context/request events are intentionally NOT forwarded — they
   * belong to the child's own lifecycle and would corrupt the parent thread's
   * turn state if replayed under the parent threadId.
   */
  private onChildEvent(record: RunRecord, event: RuntimeEvent): void {
    switch (event.type) {
      case "content.delta":
        if (event.stream === "assistant_text") record.output += event.delta;
        this.deps.host.appendRuntimeEvent(record.parentThreadId, this.retag(record, event));
        return;
      case "item.started":
      case "item.updated":
      case "item.completed":
        this.deps.host.appendRuntimeEvent(record.parentThreadId, this.retag(record, event));
        return;
      case "turn.completed":
        this.settle(record, event.state === "completed" ? "completed" : "failed");
        return;
      default:
        return;
    }
  }

  /**
   * Re-tag a child item event so it merges into the parent stream: point
   * threadId at the parent, prefix every child itemId, and nest top-level child
   * items under the synthetic tile (deeper items keep their prefixed parent).
   */
  private retag(record: RunRecord, event: RuntimeEvent): RuntimeEvent {
    const prefix = childItemPrefix(record.runId);
    if (event.type === "item.started") {
      return {
        ...event,
        threadId: record.parentThreadId,
        itemId: prefix + event.itemId,
        parentItemId: event.parentItemId
          ? prefix + event.parentItemId
          : syntheticItemId(record.runId),
      };
    }
    if (
      event.type === "item.updated" ||
      event.type === "item.completed" ||
      event.type === "content.delta"
    ) {
      return { ...event, threadId: record.parentThreadId, itemId: prefix + event.itemId };
    }
    return { ...event, threadId: record.parentThreadId };
  }

  /**
   * Terminal transition (idempotent): mark settled, tear the child down, emit
   * the synthetic tile completion (which drains buffered child events in the
   * router), and release waiters.
   */
  private settle(record: RunRecord, status: SubagentRunStatus, errorMessage?: string): void {
    if (record.settled) return;
    record.settled = true;
    if (record.status === "running") record.status = status;
    void this.teardown(record);

    const text = errorMessage ? `${record.output}\n${errorMessage}`.trim() : record.output;
    if (errorMessage) record.output = text;
    const payload: ToolCallPayload = {
      name: record.label,
      status: record.status === "completed" ? "success" : "error",
      isSubAgent: true,
      ...(text ? { result: text } : {}),
    };
    this.deps.host.appendRuntimeEvent(record.parentThreadId, {
      type: "item.completed",
      threadId: record.parentThreadId,
      itemId: syntheticItemId(record.runId),
      payload,
    });

    record.resolveSettled();
  }

  private async teardown(record: RunRecord): Promise<void> {
    const handle = record.handle;
    if (!handle) return;
    record.handle = undefined;
    try {
      if (handle.interruptTurn) await handle.interruptTurn();
    } catch {}
    try {
      await handle.dispose();
    } catch {}
  }
}
