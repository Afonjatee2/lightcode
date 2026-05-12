import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import type { ProjectLocation, RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import type { StructuredSessionUpdate } from "../base";
import { OpencodeSdkSession } from "./sdkSession";

const mocks = vi.hoisted(() => ({
  acquireOpenCodeServer: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("./sdkClient", async (importActual) => {
  const actual = await importActual<typeof import("./sdkClient")>();
  return {
    ...actual,
    acquireOpenCodeServer: mocks.acquireOpenCodeServer,
  };
});

function streamOf<T>(...values: readonly T[]): AsyncGenerator<T> {
  return (async function* () {
    for (const value of values) {
      yield value;
    }
  })();
}

function serverConnectedEvent(): Event {
  return {
    id: "evt-server",
    type: "server.connected",
    properties: {},
  };
}

describe("OpencodeSdkSession", () => {
  const projectLocation: ProjectLocation = { kind: "posix", path: "/repo" };
  const config: ThreadConfig = { model: "opencode/big-pickle" };

  beforeEach(() => {
    mocks.acquireOpenCodeServer.mockReset();
  });

  it("starts the GUI event stream on activation", async () => {
    const globalEvent = vi
      .fn<() => Promise<{ stream: AsyncGenerator<Event> }>>()
      .mockResolvedValue({
        stream: streamOf(serverConnectedEvent()),
      });
    const dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    mocks.acquireOpenCodeServer.mockResolvedValue({
      client: {
        global: { event: globalEvent },
        command: { list: vi.fn<() => Promise<{ data: [] }>>().mockResolvedValue({ data: [] }) },
        session: {
          create: vi
            .fn<() => Promise<{ data: { id: string } }>>()
            .mockResolvedValue({ data: { id: "ses_test" } }),
        },
      },
      baseUrl: "http://127.0.0.1:0",
      handle: {},
      dispose,
    });

    const session = await OpencodeSdkSession.create({
      threadId: "thread-opencode",
      projectLocation,
      config,
      presentationMode: "gui",
    });
    session.setListener({
      onClose: () => {},
      onError: () => {},
      onUpdate: () => {},
      onRuntimeEvent: () => {},
    });

    await session.activate();
    expect(globalEvent).toHaveBeenCalledTimes(1);

    await session.openThread(config);

    expect(globalEvent).toHaveBeenCalledTimes(1);
    expect(globalEvent).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });

    await session.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("unwraps global payload events and ignores sync duplicates", async () => {
    const updates: StructuredSessionUpdate[] = [];
    const runtimeEvents: RuntimeEvent[] = [];
    const wrappedEvents = [
      { payload: serverConnectedEvent() },
      {
        payload: {
          id: "evt-other",
          type: "session.status",
          properties: { sessionID: "ses_other", status: { type: "busy" } },
        },
      },
      {
        payload: {
          id: "evt-busy",
          type: "session.status",
          properties: { sessionID: "ses_test", status: { type: "busy" } },
        },
      },
      {
        payload: {
          type: "sync",
          syncEvent: {
            type: "message.updated.1",
            id: "evt-sync",
            seq: 0,
            aggregateID: "sessionID",
            data: {
              sessionID: "ses_test",
              info: {
                id: "msg_sync",
                parentID: "msg_user",
                sessionID: "ses_test",
                role: "assistant",
                mode: "build",
                agent: "build",
                path: { cwd: "/repo", root: "/repo" },
                cost: 0,
                tokens: {
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
                modelID: "big-pickle",
                providerID: "opencode",
                time: { created: 0 },
              },
            },
          },
          id: "evt-sync",
        },
      },
      {
        payload: {
          id: "evt-msg",
          type: "message.updated",
          properties: {
            sessionID: "ses_test",
            info: {
              id: "msg_asst",
              parentID: "msg_user",
              sessionID: "ses_test",
              role: "assistant",
              mode: "build",
              agent: "build",
              path: { cwd: "/repo", root: "/repo" },
              cost: 0,
              tokens: {
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
              modelID: "big-pickle",
              providerID: "opencode",
              time: { created: 0 },
            },
          },
        },
      },
      {
        payload: {
          id: "evt-part",
          type: "message.part.updated",
          properties: {
            sessionID: "ses_test",
            time: 0,
            part: {
              id: "prt_asst",
              sessionID: "ses_test",
              messageID: "msg_asst",
              type: "text",
              text: "Hi",
            },
          },
        },
      },
      {
        payload: {
          id: "evt-idle",
          type: "session.idle",
          properties: { sessionID: "ses_test" },
        },
      },
    ];
    const globalEvent = vi
      .fn<() => Promise<{ stream: AsyncGenerator<unknown> }>>()
      .mockResolvedValue({
        stream: streamOf(...wrappedEvents),
      });

    mocks.acquireOpenCodeServer.mockResolvedValue({
      client: {
        global: { event: globalEvent },
        command: { list: vi.fn<() => Promise<{ data: [] }>>().mockResolvedValue({ data: [] }) },
        session: {
          create: vi
            .fn<() => Promise<{ data: { id: string } }>>()
            .mockResolvedValue({ data: { id: "ses_test" } }),
        },
      },
      baseUrl: "http://127.0.0.1:0",
      handle: {},
      dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const session = await OpencodeSdkSession.create({
      threadId: "thread-opencode",
      projectLocation,
      config,
      presentationMode: "gui",
    });
    session.setListener({
      onClose: () => {},
      onError: () => {},
      onUpdate: (update) => updates.push(update),
      onRuntimeEvent: (event) => runtimeEvents.push(event),
    });

    await session.activate();
    await session.openThread(config);

    await vi.waitFor(() => {
      expect(runtimeEvents.some((event) => event.type === "content.delta")).toBe(true);
    });

    expect(
      runtimeEvents.filter(
        (event) => event.type === "item.started" && event.itemType === "assistant_message",
      ),
    ).toHaveLength(1);
    expect(
      runtimeEvents.find(
        (event) =>
          event.type === "content.delta" &&
          event.stream === "assistant_text" &&
          event.delta === "Hi",
      ),
    ).toBeDefined();
    expect(updates.filter((update) => update.status === "working")).toHaveLength(1);
    expect(updates.some((update) => update.status === "idle")).toBe(true);

    await session.dispose();
  });

  it("surfaces OpenCode command-list entries as slash commands", async () => {
    const updates: StructuredSessionUpdate[] = [];
    const commandList = vi
      .fn<
        (input?: unknown) => Promise<{
          data: Array<{ name: string; description: string; hints: string[]; template: string }>;
        }>
      >()
      .mockResolvedValue({
        data: [
          {
            name: "review",
            description: "Review the current diff",
            hints: ["<scope>"],
            template: "",
          },
        ],
      });

    mocks.acquireOpenCodeServer.mockResolvedValue({
      client: {
        command: { list: commandList },
        session: {
          create: vi
            .fn<() => Promise<{ data: { id: string } }>>()
            .mockResolvedValue({ data: { id: "ses_test" } }),
        },
      },
      baseUrl: "http://127.0.0.1:0",
      handle: {},
      dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });

    const session = await OpencodeSdkSession.create({
      threadId: "thread-opencode",
      projectLocation,
      config,
      presentationMode: "terminal",
    });
    session.setListener({
      onClose: () => {},
      onError: () => {},
      onUpdate: (update) => updates.push(update),
      onRuntimeEvent: () => {},
    });

    await session.activate();
    await session.openThread(config);

    expect(commandList).toHaveBeenCalledTimes(1);
    expect(commandList).toHaveBeenCalledWith({ directory: "/repo" });
    expect(updates).toContainEqual(
      expect.objectContaining({
        slashCommands: [
          {
            id: "review",
            label: "review — Review the current diff",
            description: "Review the current diff",
            argumentHint: "<scope>",
          },
        ],
      }),
    );
  });
});
