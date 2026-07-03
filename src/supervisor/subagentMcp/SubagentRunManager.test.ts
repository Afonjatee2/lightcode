import { describe, expect, it } from "vitest";
import type { ProjectLocation, RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import type {
  AgentAdapter,
  CreateStructuredSessionInput,
  StructuredSessionHandle,
  StructuredSessionListener,
} from "@/supervisor/agents/base";
import {
  MAX_CONCURRENT_CHILDREN_PER_PARENT,
  SubagentRunManager,
  SubagentSpawnError,
} from "./SubagentRunManager";
import type { SubagentRunHost } from "./types";

const PARENT = "parent";
const PROJECT: ProjectLocation = { kind: "posix", path: "/tmp/project" };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeHandle implements StructuredSessionHandle {
  launchOptions = {};
  listener: StructuredSessionListener | undefined;
  disposed = false;
  interrupted = false;
  startTurns: Array<{ prompt: string; config: ThreadConfig }> = [];

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;
  }
  async startTurn(prompt: string, config: ThreadConfig): Promise<void> {
    this.startTurns.push({ prompt, config });
  }
  async interruptTurn(): Promise<void> {
    this.interrupted = true;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
  }

  emit(event: RuntimeEvent): void {
    this.listener?.onRuntimeEvent?.(event);
  }
  completeTurn(state: "completed" | "failed" | "interrupted" | "cancelled"): void {
    this.emit({ type: "turn.completed", threadId: "child", turnId: "turn-1", state });
  }
}

interface Harness {
  manager: SubagentRunManager;
  handles: FakeHandle[];
  inputs: CreateStructuredSessionInput[];
  appended: Array<{ threadId: string; event: RuntimeEvent }>;
}

function makeHarness(options?: { models?: Array<{ id: string; label: string }> }): Harness {
  const handles: FakeHandle[] = [];
  const inputs: CreateStructuredSessionInput[] = [];
  const appended: Array<{ threadId: string; event: RuntimeEvent }> = [];

  const adapter = {
    kind: "codex",
    label: "Codex",
    capabilities: {
      models: options?.models ?? [{ id: "gpt-5.5", label: "GPT-5.5" }],
      efforts: ["low", "high"],
    },
    createStructuredSession: async (input: CreateStructuredSessionInput) => {
      inputs.push(input);
      const handle = new FakeHandle();
      handles.push(handle);
      return handle;
    },
  } as unknown as AgentAdapter;

  const host: SubagentRunHost = {
    getParentContext: (threadId) =>
      threadId === PARENT
        ? {
            projectLocation: PROJECT,
            config: {
              model: "parent-model",
              approvalPolicy: "never",
              sandboxMode: "workspace-write",
            },
          }
        : undefined,
    appendRuntimeEvent: (threadId, event) => appended.push({ threadId, event }),
  };

  const manager = new SubagentRunManager({
    adapters: new Map([["codex" as never, adapter]]),
    host,
  });
  return { manager, handles, inputs, appended };
}

describe("SubagentRunManager", () => {
  it("emits a synthetic sub-agent tool_call tile on spawn", () => {
    const h = makeHarness();
    const { runId } = h.manager.spawn(PARENT, { agent: "codex", prompt: "do work" });
    const started = h.appended.find((a) => a.event.type === "item.started");
    expect(started).toBeDefined();
    const event = started!.event as Extract<RuntimeEvent, { type: "item.started" }>;
    expect(event.threadId).toBe(PARENT);
    expect(event.itemId).toBe(`sub:${runId}`);
    expect(event.itemType).toBe("tool_call");
    expect(event.payload).toMatchObject({
      isSubAgent: true,
      status: "running",
      name: "Codex · GPT-5.5",
    });
  });

  it("re-tags child events: parentItemId → tile, itemIds prefixed with runId", async () => {
    const h = makeHarness();
    const { runId } = h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    h.handles[0]!.emit({
      type: "item.started",
      threadId: "child",
      itemId: "abc",
      itemType: "assistant_message",
    });
    const started = h.appended
      .map((a) => a.event)
      .filter(
        (e): e is Extract<RuntimeEvent, { type: "item.started" }> => e.type === "item.started",
      )
      .find((e) => e.itemId === `${runId}:abc`);
    expect(started).toBeDefined();
    expect(started!.threadId).toBe(PARENT);
    expect(started!.parentItemId).toBe(`sub:${runId}`);
  });

  it("nests a child item under its own prefixed parent when it already has one", async () => {
    const h = makeHarness();
    const { runId } = h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    h.handles[0]!.emit({
      type: "item.started",
      threadId: "child",
      itemId: "leaf",
      itemType: "assistant_message",
      parentItemId: "branch",
    });
    const started = h.appended
      .map((a) => a.event)
      .filter(
        (e): e is Extract<RuntimeEvent, { type: "item.started" }> => e.type === "item.started",
      )
      .find((e) => e.itemId === `${runId}:leaf`);
    expect(started!.parentItemId).toBe(`${runId}:branch`);
  });

  it("captures assistant text from content.delta and settles completed", async () => {
    const h = makeHarness();
    const { runId } = h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    const handle = h.handles[0]!;
    handle.emit({
      type: "content.delta",
      threadId: "child",
      itemId: "m",
      stream: "assistant_text",
      delta: "Hel",
    });
    handle.emit({
      type: "content.delta",
      threadId: "child",
      itemId: "m",
      stream: "assistant_text",
      delta: "lo",
    });
    handle.completeTurn("completed");

    const result = await h.manager.waitFor(runId, 1000);
    expect(result).toEqual({ status: "completed", output: "Hello" });

    const completion = h.appended
      .map((a) => a.event)
      .filter(
        (e): e is Extract<RuntimeEvent, { type: "item.completed" }> => e.type === "item.completed",
      )
      .find((e) => e.itemId === `sub:${runId}`);
    expect(completion).toBeDefined();
    expect(completion!.payload).toMatchObject({
      status: "success",
      isSubAgent: true,
      result: "Hello",
    });
  });

  it("does NOT forward child turn.completed onto the parent stream", async () => {
    const h = makeHarness();
    h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    h.handles[0]!.completeTurn("completed");
    const forwardedTurn = h.appended.find((a) => a.event.type === "turn.completed");
    expect(forwardedTurn).toBeUndefined();
  });

  it("run_agent-style wait returns running on timeout", async () => {
    const h = makeHarness();
    const { runId } = h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    const result = await h.manager.waitFor(runId, 5);
    expect(result.status).toBe("running");
  });

  it("cancel interrupts and disposes the child, settling cancelled", async () => {
    const h = makeHarness();
    const { runId } = h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    await h.manager.cancel(runId);
    expect(h.handles[0]!.interrupted).toBe(true);
    expect(h.handles[0]!.disposed).toBe(true);
    expect(h.manager.getStatus(runId).status).toBe("cancelled");
  });

  it("cancelAllForThread cancels live children and evicts records", async () => {
    const h = makeHarness();
    const { runId } = h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    h.manager.cancelAllForThread(PARENT);
    await flush();
    expect(h.handles[0]!.disposed).toBe(true);
    // Record evicted → unknown run_id.
    expect(h.manager.getStatus(runId).output).toContain("Unknown run_id");
  });

  it("enforces the per-parent concurrency cap", () => {
    const h = makeHarness();
    for (let i = 0; i < MAX_CONCURRENT_CHILDREN_PER_PARENT; i++) {
      h.manager.spawn(PARENT, { agent: "codex", prompt: `t${i}` });
    }
    expect(() => h.manager.spawn(PARENT, { agent: "codex", prompt: "overflow" })).toThrow(
      SubagentSpawnError,
    );
  });

  it("recursion guard: child config never carries subagentMcp/browserMcp and inherits parent posture", async () => {
    const h = makeHarness();
    h.manager.spawn(PARENT, { agent: "codex", prompt: "go", effort: "high" });
    await flush();
    const childInput = h.inputs[0]!;
    expect(childInput.config).not.toHaveProperty("subagentMcp");
    expect(childInput.config).not.toHaveProperty("browserMcp");
    expect(childInput.config.model).toBe("gpt-5.5");
    expect(childInput.config.effort).toBe("high");
    expect(childInput.config.approvalPolicy).toBe("never");
    expect(childInput.config.sandboxMode).toBe("workspace-write");
    expect(childInput.presentationMode).toBe("gui");
    expect(childInput).not.toHaveProperty("subagentMcp");
  });

  it("throws for unknown agents and missing prompts", () => {
    const h = makeHarness();
    expect(() => h.manager.spawn(PARENT, { agent: "nope", prompt: "x" })).toThrow(
      SubagentSpawnError,
    );
    expect(() => h.manager.spawn(PARENT, { agent: "codex", prompt: "  " })).toThrow(
      SubagentSpawnError,
    );
  });

  it("falls back to the adapter default model when none is given", async () => {
    const h = makeHarness();
    h.manager.spawn(PARENT, { agent: "codex", prompt: "go" });
    await flush();
    expect(h.inputs[0]!.config.model).toBe("gpt-5.5");
  });
});
