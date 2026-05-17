import { describe, expect, it, vi } from "vitest";
import type {
  PermissionMode,
  Query,
  SDKControlGetContextUsageResponse,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProjectLocation, RuntimeEvent, SessionRef, ThreadConfig } from "@/shared/contracts";
import type { StructuredSessionUpdate } from "../base";
import { ClaudeSdkSession } from "./sdkSession";

const mockSdk = vi.hoisted(() => ({
  query: vi.fn<(input: unknown) => Query>(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockSdk.query,
}));

function createFakeQuery(initCommands: Array<Record<string, string>> = []) {
  let closed = false;
  let resolveNext: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  const setModel = vi.fn<(model?: string) => Promise<void>>().mockResolvedValue(undefined);
  const setPermissionMode = vi
    .fn<(mode: PermissionMode) => Promise<void>>()
    .mockResolvedValue(undefined);
  const getContextUsage = vi
    .fn<() => Promise<SDKControlGetContextUsageResponse>>()
    .mockResolvedValue({
      categories: [{ name: "Messages", tokens: 42_000, color: "#3366ff" }],
      totalTokens: 42_000,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      percentage: 4.2,
      gridRows: [],
      model: "claude-opus-4-7[1m]",
      memoryFiles: [],
      mcpTools: [],
      isAutoCompactEnabled: true,
      agents: [],
      apiUsage: null,
    });

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
    initializationResult: vi.fn<() => Promise<unknown>>().mockResolvedValue({
      commands: initCommands,
    }),
    supportedCommands: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    supportedModels: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    getContextUsage,
    close: vi.fn<() => void>(() => {
      closed = true;
      resolveNext?.({ done: true, value: undefined });
    }),
  } as unknown as Query;

  return {
    runtime,
    setModel,
    setPermissionMode,
    getContextUsage,
    emitMessage(message: SDKMessage): void {
      const resolve = resolveNext;
      resolveNext = undefined;
      resolve?.({ done: false, value: message });
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function sdkSystemMessage(
  subtype: "hook_started" | "hook_progress" | "hook_response" | "session_state_changed",
  sessionId: string,
  extra: Record<string, unknown> = {},
): SDKMessage {
  return {
    type: "system",
    subtype,
    uuid: `uuid-${subtype}`,
    session_id: sessionId,
    ...extra,
  } as unknown as SDKMessage;
}

describe("ClaudeSdkSession", () => {
  const projectLocation: ProjectLocation = { kind: "windows", path: "C:\\repo" };
  const config: ThreadConfig = { model: "sonnet" };
  const sessionRef: SessionRef = {
    providerSessionId: "11111111-1111-4111-8111-111111111111",
    discoveredAt: "2026-05-14T00:00:00.000Z",
  };

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
      onError: () => {},
      onClose: () => {},
    });

    await session.openThread(config);
    const startTurn = session.startTurn("hello", config);

    expect(updates.at(-1)).toMatchObject({ status: "working", attention: "working" });
    expect(runtimeEvents.some((event) => event.type === "turn.started")).toBe(true);

    await expect(startTurn).resolves.toBeUndefined();

    expect(mockSdk.query).toHaveBeenCalledTimes(1);
    expect(mockSdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          includePartialMessages: true,
          forwardSubagentText: true,
        }),
      }),
    );
    expect(fake.setModel).toHaveBeenCalledWith("sonnet");
    expect(fake.setPermissionMode).toHaveBeenCalledWith("auto");

    await session.dispose();
  });

  it("resumes with the persisted session id without adopting transient hook ids", async () => {
    mockSdk.query.mockClear();
    const fake = createFakeQuery();
    mockSdk.query.mockReturnValue(fake.runtime);
    const updates: StructuredSessionUpdate[] = [];
    const session = await ClaudeSdkSession.create({
      threadId: "thread-claude-resume",
      projectLocation,
      config,
      sessionRef,
      presentationMode: "gui",
    });
    session.setListener({
      onRuntimeEvent: () => {},
      onUpdate: (update) => updates.push(update),
      onError: () => {},
      onClose: () => {},
    });

    await expect(session.openThread(config, sessionRef)).resolves.toBe(
      sessionRef.providerSessionId,
    );

    const queryInput = mockSdk.query.mock.calls[0]?.[0] as { options?: Record<string, unknown> };
    expect(queryInput.options).toMatchObject({ resume: sessionRef.providerSessionId });
    expect(queryInput.options).not.toHaveProperty("sessionId");

    fake.emitMessage(sdkSystemMessage("hook_started", "22222222-2222-4222-8222-222222222222"));
    await flushAsyncWork();

    expect(updates).not.toContainEqual(
      expect.objectContaining({
        status: "working",
        sessionRef: expect.objectContaining({
          providerSessionId: "22222222-2222-4222-8222-222222222222",
        }),
      }),
    );

    fake.emitMessage(
      sdkSystemMessage("session_state_changed", "22222222-2222-4222-8222-222222222222", {
        state: "idle",
      }),
    );
    await vi.waitFor(() => {
      expect(updates.some((update) => update.status === "idle")).toBe(true);
    });
    expect(
      updates.some(
        (update) => update.sessionRef?.providerSessionId === "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe(false);

    await session.dispose();
  });

  it("starts new SDK sessions with an explicit session id without marking idle threads working", async () => {
    mockSdk.query.mockClear();
    const fake = createFakeQuery();
    mockSdk.query.mockReturnValue(fake.runtime);
    const updates: StructuredSessionUpdate[] = [];
    const session = await ClaudeSdkSession.create({
      threadId: "thread-claude-new",
      projectLocation,
      config,
      presentationMode: "gui",
    });
    session.setListener({
      onRuntimeEvent: () => {},
      onUpdate: (update) => updates.push(update),
      onError: () => {},
      onClose: () => {},
    });

    const openedSessionId = await session.openThread(config);
    expect(openedSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const queryInput = mockSdk.query.mock.calls[0]?.[0] as { options?: Record<string, unknown> };
    expect(queryInput.options).not.toHaveProperty("resume");
    expect(queryInput.options).toHaveProperty("sessionId", openedSessionId);

    fake.emitMessage(
      sdkSystemMessage("session_state_changed", openedSessionId, {
        state: "idle",
      }),
    );

    await vi.waitFor(() => {
      expect(updates).toContainEqual(
        expect.objectContaining({
          status: "idle",
          attention: "none",
        }),
      );
    });
    expect(updates.some((update) => update.status === "working")).toBe(false);

    await session.dispose();
  });

  it("surfaces live SDK slash commands on GUI sessions", async () => {
    const fake = createFakeQuery([
      {
        name: "goal",
        description: "Set a goal — keep working until the condition is met",
        argumentHint: "",
      },
    ]);
    mockSdk.query.mockReturnValue(fake.runtime);
    const updates: StructuredSessionUpdate[] = [];
    const session = await ClaudeSdkSession.create({
      threadId: "thread-claude-goal",
      projectLocation,
      config,
      presentationMode: "gui",
    });
    session.setListener({
      onRuntimeEvent: () => {},
      onUpdate: (update) => updates.push(update),
      onError: () => {},
      onClose: () => {},
    });

    await session.openThread(config);
    await Promise.resolve();

    expect(updates).toContainEqual(
      expect.objectContaining({
        slashCommands: [
          {
            id: "goal",
            label: "goal — Set a goal — keep working until the condition is met",
            description: "Set a goal — keep working until the condition is met",
          },
        ],
      }),
    );

    await session.dispose();
  });

  it("refreshes current SDK context usage after result messages", async () => {
    const fake = createFakeQuery();
    mockSdk.query.mockReturnValue(fake.runtime);
    const runtimeEvents: RuntimeEvent[] = [];
    const session = await ClaudeSdkSession.create({
      threadId: "thread-claude-context",
      projectLocation,
      config: { model: "claude-opus-4-7", contextSize: "1m" },
      presentationMode: "gui",
    });
    session.setListener({
      onRuntimeEvent: (event) => runtimeEvents.push(event),
      onUpdate: () => {},
      onError: () => {},
      onClose: () => {},
    });

    await session.openThread({ model: "claude-opus-4-7", contextSize: "1m" });
    await flushAsyncWork();

    fake.emitMessage({
      type: "result",
      subtype: "success",
      usage: { total_tokens: 4_000_000 },
      session_id: "claude-session",
    } as unknown as SDKMessage);
    await flushAsyncWork();

    expect(fake.getContextUsage).toHaveBeenCalledTimes(1);
    expect(runtimeEvents).toContainEqual({
      type: "context.updated",
      threadId: "thread-claude-context",
      usage: {
        usedTokens: 42_000,
        maxTokens: 1_000_000,
        breakdown: [{ id: "messages-0", label: "Messages", tokens: 42_000 }],
      },
    });
    expect(
      runtimeEvents.some(
        (event) => event.type === "context.updated" && event.usage.usedTokens === 4_000_000,
      ),
    ).toBe(false);

    await session.dispose();
  });
});
