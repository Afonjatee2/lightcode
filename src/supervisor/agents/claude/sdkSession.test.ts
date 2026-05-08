import { describe, expect, it, vi } from "vitest";
import type { PermissionMode, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProjectLocation, RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import type { StructuredSessionUpdate } from "../base";
import { ClaudeSdkSession } from "./sdkSession";

const mockSdk = vi.hoisted(() => ({
  query: vi.fn<(input: unknown) => Query>(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockSdk.query,
}));

function createFakeQuery() {
  let closed = false;
  let resolveNext: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  const setModel = vi.fn<(model?: string) => Promise<void>>().mockResolvedValue(undefined);
  const setPermissionMode = vi
    .fn<(mode: PermissionMode) => Promise<void>>()
    .mockResolvedValue(undefined);

  const runtime = {
    async next(): Promise<IteratorResult<SDKMessage>> {
      if (closed) return { done: true, value: undefined };
      return new Promise<IteratorResult<SDKMessage>>((resolve) => {
        resolveNext = resolve;
      });
    },
    async return(): Promise<IteratorResult<SDKMessage>> {
      closed = true;
      return { done: true, value: undefined };
    },
    async throw(error?: unknown): Promise<IteratorResult<SDKMessage>> {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    interrupt: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setPermissionMode,
    setModel,
    setMaxThinkingTokens: vi
      .fn<(maxThinkingTokens: number | null) => Promise<void>>()
      .mockResolvedValue(undefined),
    applyFlagSettings: vi.fn<(settings: unknown) => Promise<void>>().mockResolvedValue(undefined),
    initializationResult: vi.fn<() => Promise<unknown>>().mockResolvedValue({ commands: [] }),
    supportedCommands: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    supportedModels: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    close: vi.fn<() => void>(() => {
      closed = true;
      resolveNext?.({ done: true, value: undefined });
    }),
  } as unknown as Query;

  return { runtime, setModel, setPermissionMode };
}

describe("ClaudeSdkSession", () => {
  const projectLocation: ProjectLocation = { kind: "windows", path: "C:\\repo" };
  const config: ThreadConfig = { model: "sonnet" };

  it("waits for SDK query creation before sending the first GUI turn", async () => {
    const fake = createFakeQuery();
    mockSdk.query.mockReturnValue(fake.runtime);
    const runtimeEvents: RuntimeEvent[] = [];
    const updates: StructuredSessionUpdate[] = [];
    const session = await ClaudeSdkSession.create({
      threadId: "thread-claude-sdk",
      projectLocation,
      config,
      presentationMode: "gui",
    });
    session.setListener({
      onRuntimeEvent: (event) => runtimeEvents.push(event),
      onUpdate: (update) => updates.push(update),
      onServerRequest: () => {},
      onError: () => {},
      onClose: () => {},
    });

    await session.openThread(config);
    const startTurn = session.startTurn("hello", config);

    expect(updates.at(-1)).toMatchObject({ status: "working", attention: "working" });
    expect(runtimeEvents.some((event) => event.type === "turn.started")).toBe(true);

    await expect(startTurn).resolves.toBeUndefined();

    expect(mockSdk.query).toHaveBeenCalledTimes(1);
    expect(fake.setModel).toHaveBeenCalledWith("sonnet");
    expect(fake.setPermissionMode).toHaveBeenCalledWith("auto");

    await session.dispose();
  });
});
