import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteThreadCommand, StartThreadPayload, Thread } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { handleOrchestratorThreadCreated } from "./orchestratorThreadBridge";

vi.mock("./db", () => ({
  dbGetThread: vi.fn<(threadId: string) => Thread | null>(),
  dbUpsertThread: vi.fn<(thread: Thread, sortOrder: number) => void>(),
  dbSetThreadGroup: vi.fn<(threadId: string, groupId: string, groupName: string) => void>(),
  dbDeleteThread: vi.fn<(threadId: string) => void>(),
}));

const db = vi.mocked(await import("./db"));

type CreatedEvent = Extract<SupervisorEvent, { type: "orchestrator-thread-created" }>;

const NOW = "2026-07-01T00:00:00.000Z";

function makeParent(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "parent-1",
    projectId: "project-1",
    title: "Parent orchestrator",
    agentKind: "claude" as Thread["agentKind"],
    config: { model: "claude-fable-5" },
    status: "working",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CreatedEvent> = {}): CreatedEvent {
  const thread: Omit<Thread, "projectId"> = {
    id: "child-1",
    title: "PORA-123",
    agentKind: "codex" as Thread["agentKind"],
    config: { model: "gpt-5.5" },
    status: "launching",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    parentThreadId: "parent-1",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const start: StartThreadPayload = {
    threadId: "child-1",
    projectLocation: { kind: "posix", path: "/tmp/project" },
    agentKind: "codex" as Thread["agentKind"],
    config: { model: "gpt-5.5" },
    prompt: "do the ticket",
    initialSize: { cols: 120, rows: 30 },
    presentationMode: "gui",
  };
  return {
    type: "orchestrator-thread-created",
    parentThreadId: "parent-1",
    thread,
    start,
    ...overrides,
  };
}

function makeDeps(options?: { rendererUp?: boolean; startThreadError?: Error }) {
  const commands: RemoteThreadCommand[] = [];
  const startThread = vi.fn<() => Promise<unknown>>(async () => {
    if (options?.startThreadError) throw options.startThreadError;
    return {};
  });
  return {
    commands,
    startThread,
    deps: {
      startThread,
      sendThreadCommand: (command: RemoteThreadCommand) => {
        if (options?.rendererUp === false) return false;
        commands.push(command);
        return true;
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleOrchestratorThreadCreated grouping", () => {
  it("groups the child with a groupless parent under a group keyed by the parent", async () => {
    db.dbGetThread.mockImplementation((id: string) => (id === "parent-1" ? makeParent() : null));
    const { deps, commands } = makeDeps();

    await handleOrchestratorThreadCreated(makeEvent(), deps);

    // Child row persisted with the parent's projectId and the family group.
    expect(db.dbUpsertThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "child-1",
        projectId: "project-1",
        parentThreadId: "parent-1",
        groupId: "parent-1",
        groupName: "Parent orchestrator",
      }),
      expect.any(Number),
    );
    // Parent pulled into the group via the renderer-owned metadata path.
    expect(commands).toContainEqual({
      kind: "set-group",
      threadId: "parent-1",
      groupId: "parent-1",
      groupName: "Parent orchestrator",
    });
    expect(db.dbSetThreadGroup).not.toHaveBeenCalled();
    // The renderer mirror of the child carries the same group.
    const start = commands.find((c) => c.kind === "start");
    expect(start).toMatchObject({
      threadId: "child-1",
      groupId: "parent-1",
      groupName: "Parent orchestrator",
      parentThreadId: "parent-1",
      launchRuntime: false,
      focus: false,
    });
  });

  it("reuses the parent's existing group without re-assigning the parent", async () => {
    db.dbGetThread.mockImplementation((id: string) =>
      id === "parent-1" ? makeParent({ groupId: "group-9", groupName: "My group" }) : null,
    );
    const { deps, commands } = makeDeps();

    await handleOrchestratorThreadCreated(makeEvent(), deps);

    expect(commands.some((c) => c.kind === "set-group")).toBe(false);
    expect(db.dbUpsertThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "child-1", groupId: "group-9", groupName: "My group" }),
      expect.any(Number),
    );
  });

  it("writes the parent's group straight to the DB when no renderer window is up", async () => {
    db.dbGetThread.mockImplementation((id: string) => (id === "parent-1" ? makeParent() : null));
    const { deps } = makeDeps({ rendererUp: false });

    await handleOrchestratorThreadCreated(makeEvent(), deps);

    expect(db.dbSetThreadGroup).toHaveBeenCalledWith("parent-1", "parent-1", "Parent orchestrator");
  });

  it("rolls back a fresh row when the supervisor launch fails", async () => {
    db.dbGetThread.mockImplementation((id: string) => (id === "parent-1" ? makeParent() : null));
    const { deps, commands } = makeDeps({ startThreadError: new Error("boom") });

    await handleOrchestratorThreadCreated(makeEvent(), deps);

    expect(db.dbDeleteThread).toHaveBeenCalledWith("child-1");
    expect(commands).toContainEqual({ kind: "delete", threadId: "child-1" });
  });

  it("drops the child when the parent row is gone", async () => {
    db.dbGetThread.mockReturnValue(null);
    const { deps, commands } = makeDeps();

    await handleOrchestratorThreadCreated(makeEvent(), deps);

    expect(db.dbUpsertThread).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });
});
