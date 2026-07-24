import type {
  CreateChildThreadResult,
  OrchestratorThreadManager,
} from "@/supervisor/crossagentMcp/OrchestratorThreadManager";
import type { ChildExecutionPort, ChildLaunchInput, ChildOutcome } from "./ports";

/**
 * Production {@link ChildExecutionPort} binding. Consultations are launched as
 * REAL first-class child threads through the existing OrchestratorThreadManager
 * lane (the Crossagents MCP `create_thread` mechanism) — the coordinator does
 * not reinvent child launch/cancel. Cancellation uses the manager's real
 * interrupt + close path.
 */
export interface OrchestratorChildExecutionDeps {
  orchestrator: OrchestratorThreadManager;
  /** Resolves a child's parent thread (cached from launch; falls back to the DB after a restart). */
  resolveParentThreadId?: (childThreadOrRunId: string) => string | undefined;
  awaitTimeoutMs?: number;
}

const DEFAULT_AWAIT_TIMEOUT_MS = 5 * 60_000;

export class OrchestratorChildExecution implements ChildExecutionPort {
  private readonly parentByChild = new Map<string, string>();
  private readonly awaitTimeoutMs: number;

  constructor(private readonly deps: OrchestratorChildExecutionDeps) {
    this.awaitTimeoutMs = deps.awaitTimeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS;
  }

  async launch(input: ChildLaunchInput): Promise<{ childThreadOrRunId: string }> {
    const result: CreateChildThreadResult = await this.deps.orchestrator.createThread(
      input.parentThreadId,
      {
        agent: input.provider,
        prompt: input.prompt,
        model: input.model,
        ...(input.title ? { title: input.title } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        worktree: false,
      },
    );
    this.parentByChild.set(result.threadId, input.parentThreadId);
    return { childThreadOrRunId: result.threadId };
  }

  async cancel(childThreadOrRunId: string): Promise<void> {
    const parentThreadId = this.parentOf(childThreadOrRunId);
    if (!parentThreadId) return;
    await this.deps.orchestrator.interruptThread(parentThreadId, childThreadOrRunId);
    await this.deps.orchestrator.closeThread(parentThreadId, childThreadOrRunId);
  }

  async awaitOutcome(childThreadOrRunId: string, signal?: AbortSignal): Promise<ChildOutcome> {
    const parentThreadId = this.parentOf(childThreadOrRunId);
    if (!parentThreadId) {
      return { status: "failed", rawOutput: "", errorMessage: "Unknown child thread" };
    }
    const deadline = Date.now() + this.awaitTimeoutMs;
    for (;;) {
      if (signal?.aborted) return { status: "cancelled", rawOutput: "" };
      const remaining = Math.max(0, deadline - Date.now());
      const waited = await this.deps.orchestrator.waitForThreads(
        parentThreadId,
        [childThreadOrRunId],
        Math.min(remaining, 5_000),
      );
      if (waited.settled.includes(childThreadOrRunId)) {
        return this.outcomeFrom(parentThreadId, childThreadOrRunId);
      }
      if (Date.now() >= deadline) {
        return { status: "failed", rawOutput: "", errorMessage: "Child thread did not settle in time" };
      }
    }
  }

  async inspect(childThreadOrRunId: string): Promise<"active" | "gone"> {
    const parentThreadId = this.parentOf(childThreadOrRunId);
    if (!parentThreadId) return "gone";
    const known = this.deps.orchestrator
      .listThreads(parentThreadId)
      .some((thread) => thread.threadId === childThreadOrRunId);
    return known ? "active" : "gone";
  }

  private outcomeFrom(parentThreadId: string, childThreadOrRunId: string): ChildOutcome {
    const thread = this.deps.orchestrator.getThread(parentThreadId, childThreadOrRunId);
    const output = thread.finalResult ?? thread.recentOutput ?? "";
    if (thread.status === "error") {
      return { status: "failed", rawOutput: output, errorMessage: thread.error ?? "Child thread errored" };
    }
    if (thread.status === "inactive" && output.length === 0) {
      return { status: "failed", rawOutput: "", errorMessage: "Child session ended without output" };
    }
    return { status: "completed", rawOutput: output };
  }

  private parentOf(childThreadOrRunId: string): string | undefined {
    return this.parentByChild.get(childThreadOrRunId) ?? this.deps.resolveParentThreadId?.(childThreadOrRunId);
  }
}
