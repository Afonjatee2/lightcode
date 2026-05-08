import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLightcodePaths } from "@/shared/lightcodePaths";

const taskkillSpawnSyncMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const ptySpawnMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const appendFileMock = vi.hoisted(() =>
  vi.fn<(path: string, data: string, encoding: string) => Promise<void>>(),
);

vi.mock("node:child_process", async (importActual) => {
  const actual = await importActual<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((command, args, options) => {
      if (command === "taskkill") {
        return taskkillSpawnSyncMock(command, args, options);
      }
      return actual.spawnSync(command, args, options);
    }) as typeof actual.spawnSync,
  };
});

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: appendFileMock,
  };
});

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: appendFileMock,
  };
});

vi.mock("node-pty", () => ({
  spawn: ptySpawnMock,
}));

import { detectWslAgentStatuses, SupervisorRuntime, writeSubmittedPrompt } from "./runtime";

const tempDirs: string[] = [];
const lightcodeDataDirBeforeTests = process.env.LIGHTCODE_DATA_DIR;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lightcode-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  // Restoring an env var to `undefined` coerces it to the literal string
  // "undefined" (Node stringifies anything assigned to `process.env.X`).
  // That bug used to cause the supervisor to resolve its baseDir as the
  // string "undefined" and create `./undefined/settings.json` in cwd on
  // the next `SupervisorRuntime` construction. Use `delete` when the
  // original value was absent; assign otherwise.
  if (lightcodeDataDirBeforeTests === undefined) {
    delete process.env.LIGHTCODE_DATA_DIR;
  } else {
    process.env.LIGHTCODE_DATA_DIR = lightcodeDataDirBeforeTests;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createMockPty() {
  let onDataHandler: ((data: string) => void) | undefined;
  let onExitHandler: ((event: { exitCode: number | null }) => void) | undefined;

  return {
    pid: 4242,
    write: vi.fn<(data: string) => void>(),
    resize: vi.fn<(cols: number, rows: number) => void>(),
    kill: vi.fn<() => void>(),
    onData: vi.fn<(handler: (data: string) => void) => void>((handler) => {
      onDataHandler = handler;
    }),
    onExit: vi.fn<(handler: (event: { exitCode: number | null }) => void) => void>((handler) => {
      onExitHandler = handler;
    }),
    emitData(data: string) {
      onDataHandler?.(data);
    },
    emitExit(exitCode: number | null) {
      onExitHandler?.({ exitCode });
    },
  };
}

function decodeSpawnCommand(spawnArgs: string[]): string {
  // On Windows hosts, supervisor wraps spawns through PowerShell with
  // -EncodedCommand and quoted args; on non-Windows hosts the test sees the
  // cmd.exe fallback (raw, unquoted). Strip surrounding quotes so assertions
  // can search for the same tokens regardless of host.
  const raw = spawnArgs.includes("-EncodedCommand")
    ? Buffer.from(spawnArgs.at(-1)!, "base64").toString("utf16le")
    : spawnArgs.join(" ");
  return raw.replaceAll("'", "");
}

function createRuntimeSession(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: "instance-1",
    threadId: "thread-1",
    agentKind: "codex",
    adapter: {
      kind: "codex",
      label: "Codex",
      capabilities: {
        models: [],
        efforts: [],
        modes: [],
        approvalPolicies: [],
        sandboxModes: [],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "server",
        presentationMode: "terminal",
      },
    },
    pty: {
      write: vi.fn<(data: string) => void>(),
      resize: vi.fn<(cols: number, rows: number) => void>(),
      kill: vi.fn<() => void>(),
    },
    projectLocation: {
      kind: "windows",
      path: "C:\\repo",
    },
    config: {
      model: "gpt-5.4",
    },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    terminalSize: {
      cols: 120,
      rows: 30,
    },
    logPath: "thread.log",
    outputLength: 0,
    prevChunk: "",
    lastStrippedPtyChunk: "",
    structuredSession: {
      launchOptions: {},
      activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      startTurn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      resolveServerRequest: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      setListener: vi.fn<(listener: unknown) => void>(),
      dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe("writeSubmittedPrompt", () => {
  beforeEach(() => {
    vi.useRealTimers();
    taskkillSpawnSyncMock.mockReset();
    ptySpawnMock.mockReset();
    appendFileMock.mockReset();
  });

  it("writes direct-input chunks sequentially with delays between them", async () => {
    vi.useFakeTimers();
    const write = vi.fn<(data: string) => void>();

    const pending = writeSubmittedPrompt({ write }, ["h", "i", "\r"], {
      kind: "posix",
      path: "/tmp/project",
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenNthCalledWith(1, "h");

    await vi.runAllTimersAsync();
    await pending;

    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenNthCalledWith(2, "i");
    expect(write).toHaveBeenNthCalledWith(3, "\r");
    vi.useRealTimers();
  });

  it("preserves inner newlines on posix so the prompt is not submitted mid-stream", async () => {
    vi.useFakeTimers();
    const write = vi.fn<(data: string) => void>();

    const pending = writeSubmittedPrompt({ write }, ["hi\n\n@/tmp/file ", "\r"], {
      kind: "posix",
      path: "/tmp/project",
    });

    await vi.runAllTimersAsync();
    await pending;

    expect(write).toHaveBeenNthCalledWith(1, "hi\n\n@/tmp/file ");
    expect(write).toHaveBeenNthCalledWith(2, "\r");
    vi.useRealTimers();
  });

  it("passes chunks through unchanged on Windows (no global newline rewrite)", async () => {
    vi.useFakeTimers();
    const write = vi.fn<(data: string) => void>();

    const pending = writeSubmittedPrompt({ write }, ["hi\n\n@C:/tmp/file ", "\r"], {
      kind: "windows",
      path: "C:/tmp/project",
    });

    await vi.runAllTimersAsync();
    await pending;

    expect(write).toHaveBeenNthCalledWith(1, "hi\n\n@C:/tmp/file ");
    expect(write).toHaveBeenNthCalledWith(2, "\r");
    vi.useRealTimers();
  });

  it("routes server-controlled thread input through structured turn start", async () => {
    const emitted: unknown[] = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession();

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await runtime.sendThreadInput({
      threadId: session.threadId,
      prompt: "hello",
      config: {
        model: "gpt-5.4",
      },
    });

    expect(session.structuredSession.startTurn).toHaveBeenCalledWith(
      "hello",
      {
        model: "gpt-5.4",
      },
      undefined,
      undefined,
    );
    expect(session.pty.write).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it("returns immediately while server-controlled turn start continues in the background", async () => {
    let resolveStartTurn: (() => void) | undefined;
    const emitted: unknown[] = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession({
      structuredSession: {
        launchOptions: {},
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn: vi.fn<() => Promise<void>>(
          () =>
            new Promise<void>((resolve) => {
              resolveStartTurn = resolve;
            }),
        ),
        resolveServerRequest: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await expect(
      runtime.sendThreadInput({
        threadId: session.threadId,
        prompt: "hello",
        config: {
          model: "gpt-5.4",
        },
      }),
    ).resolves.toBeUndefined();

    expect(session.structuredSession.startTurn).toHaveBeenCalledWith(
      "hello",
      {
        model: "gpt-5.4",
      },
      undefined,
      undefined,
    );
    expect(emitted).toEqual([]);

    resolveStartTurn?.();
  });

  it("marks the thread as error when server-controlled turn start fails asynchronously", async () => {
    const emitted: unknown[] = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession({
      structuredSession: {
        launchOptions: {},
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("request failed")),
        resolveServerRequest: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await runtime.sendThreadInput({
      threadId: session.threadId,
      prompt: "hello",
      config: {
        model: "gpt-5.4",
      },
    });
    await Promise.resolve();

    expect(emitted).toEqual([
      expect.objectContaining({
        type: "thread-state",
        threadId: session.threadId,
        status: "error",
        attention: "error",
        errorMessage: "request failed",
      }),
    ]);
  });

  it("stages GUI submit-while-working as a single pending steer with replace-latest, interrupts once, and drains the latest on idle", async () => {
    const runtime = new SupervisorRuntime(() => undefined);
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const interruptTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          structuredSession: Record<string, unknown>;
          presentationMode: "gui";
        }) => { status: string };
      }
    ).spawnThread({
      threadId: "thread-gui-queue",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["low"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "read-only", label: "Read Only" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
        },
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      structuredSession: {
        launchOptions: {},
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn,
        interruptTurn,
      },
      presentationMode: "gui",
    });

    (
      runtime as unknown as {
        sessions: Map<
          string,
          {
            status: string;
            structuredSession: { setListener: ReturnType<typeof vi.fn> };
          }
        >;
      }
    ).sessions.get("thread-gui-queue")!.status = "working";

    await runtime.sendThreadInput({
      threadId: "thread-gui-queue",
      prompt: "first",
      config: {
        model: "gpt-5.4",
      },
      userMessageItemId: "user-first",
    });
    await runtime.sendThreadInput({
      threadId: "thread-gui-queue",
      prompt: "second",
      config: {
        model: "gpt-5.4",
      },
      userMessageItemId: "user-second",
    });

    // Replace-latest: both submits stage into the same slot. interruptTurn
    // fires once; startTurn waits for cancel-ack via the idle transition.
    expect(interruptTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).not.toHaveBeenCalled();

    const listener = (
      (
        runtime as unknown as {
          sessions: Map<
            string,
            {
              structuredSession: { setListener: ReturnType<typeof vi.fn> };
            }
          >;
        }
      ).sessions.get("thread-gui-queue")!.structuredSession.setListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { onUpdate: (update: { status: string; attention: string }) => void };

    listener.onUpdate({ status: "idle", attention: "none" });
    await Promise.resolve();

    // Only the latest submit drains; the earlier one was replaced.
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith(
      "second",
      {
        model: "gpt-5.4",
      },
      undefined,
      { userMessageItemId: "user-second" },
    );
  });

  it("does not emit runtime status updates for raw terminal writes", async () => {
    const emitted: unknown[] = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event);
    });
    const session = createRuntimeSession({
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
      },
      structuredSession: undefined,
    });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    await runtime.writeTerminal({
      threadId: session.threadId,
      data: "hello\r",
    });

    expect(session.pty.write).toHaveBeenCalledWith("hello\r");
    expect(emitted).toHaveLength(0);
  });

  it("keeps terminal scrollback in a capped transcript buffer", () => {
    const runtime = new SupervisorRuntime(() => undefined);
    const session = createRuntimeSession({ prevChunk: "" });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "a".repeat(120_000));
    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "b".repeat(120_000));

    const scrollback = runtime.readTerminalScrollback(session.threadId);
    expect(scrollback).toHaveLength(100_000);
    expect(scrollback.startsWith("b")).toBe(true);
  });

  it("buffers dev PTY log writes instead of writing each chunk synchronously", async () => {
    vi.useFakeTimers();
    process.env.VITE_DEV_SERVER_URL = "http://localhost:5173";
    const tempDir = makeTempDir();
    process.env.LIGHTCODE_DATA_DIR = tempDir;
    const runtime = new SupervisorRuntime(() => undefined);
    const session = createRuntimeSession({ prevChunk: "" });

    (runtime as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      session.threadId,
      session,
    );

    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "first");
    (
      runtime as unknown as {
        handlePtyData: (runtimeSession: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "second");

    expect(appendFileMock).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(appendFileMock).toHaveBeenCalledTimes(1);
    expect(appendFileMock.mock.calls[0]?.[1]).toBe("firstsecond");
    delete process.env.VITE_DEV_SERVER_URL;
    vi.useRealTimers();
  });

  it("keeps a working thread active when the last corroborated terminal hint is still working", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        detectTerminalStatus: (text: string) =>
          text.includes("Working (3m 38s")
            ? {
                status: "working" as const,
                attention: "working" as const,
                corroborated: true,
              }
            : null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "Working (3m 38s • esc to interrupt)");

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("working");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(0);
    vi.useRealTimers();
  });

  it("promotes Codex question screens to needs_reply before silence can mark them idle", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        detectTerminalStatus: (text: string) =>
          text.includes("enter to submit answer")
            ? {
                status: "needs_reply" as const,
                attention: "needs_reply" as const,
                corroborated: true,
              }
            : null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(
      session,
      [
        "Question 1/2 (2 unanswered)",
        "For the project tree search, what should v1 search across?",
        "",
        "tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt",
      ].join("\n"),
    );

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("needs_reply");
    expect(session.attention).toBe("needs_reply");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(0);
    vi.useRealTimers();
  });

  it("still falls back to idle after silence when no strong terminal hint remains", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        detectTerminalStatus: () => null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "Partial output without a strong status marker");

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("idle");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(1);
    vi.useRealTimers();
  });

  it("does not fall back to idle when the adapter disables the silence watchdog", async () => {
    vi.useFakeTimers();
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const session = createRuntimeSession({
      agentKind: "claude",
      status: "working",
      attention: "working",
      prevChunk: "",
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [],
          efforts: [],
          modes: [],
          approvalPolicies: [],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
        detectTerminalStatus: () => null,
        workingSilenceTimeoutMs: null,
      },
    });

    (
      runtime as unknown as {
        handlePtyData: (session: Record<string, unknown>, data: string) => void;
      }
    ).handlePtyData(session, "Puttering… (1m 34s · ↑ 3.4k tokens · thinking with high effort)");

    await vi.advanceTimersByTimeAsync(2000);

    expect(session.status).toBe("working");
    expect(
      emitted.filter((event) => event.type === "thread-state" && event.status === "idle"),
    ).toHaveLength(0);
    vi.useRealTimers();
  });

  it("uses taskkill instead of pty.kill when closing a Windows shell session", async () => {
    const runtime = new SupervisorRuntime(() => undefined);
    const shell = {
      instanceId: "shell-instance-1",
      shellId: "shell-1",
      pty: {
        pid: 4242,
        kill: vi.fn<() => void>(),
        write: vi.fn<(data: string) => void>(),
        resize: vi.fn<(cols: number, rows: number) => void>(),
      },
      logPath: "shell.log",
      outputLength: 0,
    };
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

    taskkillSpawnSyncMock.mockReturnValue({
      pid: 0,
      output: [],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
    });

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    (runtime as unknown as { shellSessions: Map<string, typeof shell> }).shellSessions.set(
      shell.shellId,
      shell,
    );

    try {
      await runtime.closeThread({ threadId: shell.shellId });
    } finally {
      processKillSpy.mockRestore();
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor);
      }
    }

    expect(taskkillSpawnSyncMock).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4242", "/T", "/F"],
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    expect(shell.pty.kill).not.toHaveBeenCalled();
  });

  it("starts the queued launch prompt when isReadyForInitialPrompt fires", async () => {
    const emitted: unknown[] = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event);
    });
    const pty = createMockPty();
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
          structuredSession: Record<string, unknown>;
          pendingLaunchPrompt: string;
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-2",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "terminal",
        },
        createInitialSessionRef: vi
          .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
          .mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
        isReadyForInitialPrompt: (text: string) =>
          text.includes("OpenAI Codex") &&
          text.includes("directory:") &&
          text.includes("/model to change"),
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "codex",
        args: [],
      },
      structuredSession: {
        launchOptions: {},
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        startTurn,
      },
      pendingLaunchPrompt: "hi",
    });

    pty.emitData(
      [
        "OpenAI Codex (v0.116.0)",
        "model: gpt-5.4-mini high /model to change",
        "directory: ~/work/site-search-ui",
      ].join("\n"),
    );
    await Promise.resolve();

    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith("hi", {
      model: "gpt-5.4",
    });
  });

  it("spoofs an iTerm terminal for Claude when running on L2", () => {
    const dataDir = makeTempDir();
    process.env.LIGHTCODE_DATA_DIR = dataDir;
    writeFileSync(resolveLightcodePaths(dataDir).settingsPath, JSON.stringify({}), "utf8");

    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();
    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-claude-l2",
      agentKind: "claude",
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [{ id: "sonnet", label: "Sonnet" }],
          efforts: ["medium"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
        createInitialSessionRef: vi.fn<() => undefined>().mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "sonnet",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "claude",
        args: [],
      },
    });

    const [, , spawnOpts] = ptySpawnMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(spawnOpts.env.TERM_PROGRAM).toBe("iTerm.app");
    expect(spawnOpts.env.TERM_PROGRAM_VERSION).toBe("3.6.6");
  });

  it("does not spoof an iTerm terminal for Claude while hooks are active", () => {
    const dataDir = makeTempDir();
    process.env.LIGHTCODE_DATA_DIR = dataDir;
    writeFileSync(resolveLightcodePaths(dataDir).settingsPath, JSON.stringify({}), "utf8");

    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();
    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
          extraEnv: Record<string, string>;
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-claude-hooks",
      agentKind: "claude",
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [{ id: "sonnet", label: "Sonnet" }],
          efforts: ["medium"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
        createInitialSessionRef: vi.fn<() => undefined>().mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "sonnet",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "claude",
        args: [],
      },
      extraEnv: {
        LIGHTCODE_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event",
      },
    });

    const [, , spawnOpts] = ptySpawnMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(spawnOpts.env.TERM_PROGRAM).toBeUndefined();
    expect(spawnOpts.env.TERM_PROGRAM_VERSION).toBeUndefined();
  });

  it("spoofs an iTerm terminal for Claude when hooks are injected but L1 is disabled", () => {
    const dataDir = makeTempDir();
    process.env.LIGHTCODE_DATA_DIR = dataDir;
    writeFileSync(
      resolveLightcodePaths(dataDir).settingsPath,
      JSON.stringify({ disableCliHookPlugin: true }),
      "utf8",
    );

    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();
    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
          extraEnv: Record<string, string>;
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-claude-l2-with-hooks",
      agentKind: "claude",
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [{ id: "sonnet", label: "Sonnet" }],
          efforts: ["medium"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
        createInitialSessionRef: vi.fn<() => undefined>().mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "sonnet",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "claude",
        args: [],
      },
      extraEnv: {
        LIGHTCODE_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event",
      },
    });

    const [, , spawnOpts] = ptySpawnMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(spawnOpts.env.TERM_PROGRAM).toBe("iTerm.app");
    expect(spawnOpts.env.TERM_PROGRAM_VERSION).toBe("3.6.6");
  });

  it("spoofs an iTerm terminal for Claude in WSL L2 sessions", () => {
    const dataDir = makeTempDir();
    process.env.LIGHTCODE_DATA_DIR = dataDir;
    writeFileSync(resolveLightcodePaths(dataDir).settingsPath, JSON.stringify({}), "utf8");

    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();
    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: {
            kind: "wsl";
            distro: string;
            linuxPath: string;
            uncPath: string;
          };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-claude-wsl-l2",
      agentKind: "claude",
      adapter: {
        kind: "claude",
        label: "Claude Code",
        capabilities: {
          models: [{ id: "sonnet", label: "Sonnet" }],
          efforts: ["medium"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal",
          presentationMode: "terminal",
        },
        createInitialSessionRef: vi.fn<() => undefined>().mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
      },
      projectLocation: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/demo/repo",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\repo",
      },
      config: {
        model: "sonnet",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "C:\\Windows\\System32\\wsl.exe",
        args: ["-d", "Ubuntu", "--cd", "/home/demo/repo"],
      },
    });

    const [, , spawnOpts] = ptySpawnMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(spawnOpts.env.TERM_PROGRAM).toBe("iTerm.app");
    expect(spawnOpts.env.TERM_PROGRAM_VERSION).toBe("3.6.6");
  });

  it("does not eagerly start a queued Codex turn during thread startup", async () => {
    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const activate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const openThread = vi.fn<() => Promise<string>>().mockResolvedValue("session-1");
    const ensureResumeArtifacts = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    ptySpawnMock.mockReturnValueOnce(pty);

    const adapter = {
      kind: "codex" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "server" as const,
        presentationMode: "terminal" as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "codex",
        args: ["resume", "session-1"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
        launchOptions: {},
        activate,
        openThread,
        ensureResumeArtifacts,
        startTurn,
        setListener: vi.fn<(listener: unknown) => void>(),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }),
      isReadyForInitialPrompt: vi.fn<(text: string) => boolean>(() => false),
    };

    (
      runtime as unknown as {
        adapters: Map<string, typeof adapter>;
      }
    ).adapters.set("codex", adapter);

    await runtime.startThread({
      threadId: "thread-3",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      prompt: "hi",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(openThread).toHaveBeenCalledTimes(1);
    expect(ensureResumeArtifacts).toHaveBeenCalledTimes(1);
    expect(startTurn).not.toHaveBeenCalled();
    expect(ptySpawnMock).toHaveBeenCalledTimes(1);
    const [, spawnArgs, spawnOpts] = ptySpawnMock.mock.calls[0] as [
      string,
      string[],
      { cols: number; rows: number },
    ];
    // argv is wrapped by resolveLaunchSpec (PowerShell on Windows);
    // the binary name and resume arg appear inside the encoded script.
    const encoded = spawnArgs.includes("-EncodedCommand")
      ? Buffer.from(spawnArgs.at(-1)!, "base64").toString("utf16le")
      : spawnArgs.join(" ");
    expect(encoded).toContain("codex");
    expect(encoded).toContain("session-1");
    expect(spawnOpts).toMatchObject({ cols: 132, rows: 42 });
  });

  it("starts Codex GUI presentation on the structured session without a PTY and stays visually working", async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event as Record<string, unknown>);
    });
    const startTurn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const setListener = vi.fn<(listener: unknown) => void>();

    const adapter = {
      kind: "codex" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
        presentationModes: ["terminal", "gui"] as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "codex",
        args: ["should-not-spawn"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
      createStructuredSession: vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
        launchOptions: { suppressResumeConfigOverrides: true, resumeThreadId: "session-1" },
        activate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        openThread: vi.fn<() => Promise<string>>().mockResolvedValue("session-1"),
        startTurn,
        setListener,
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      }),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "codex",
      adapter,
    );

    await runtime.startThread({
      threadId: "thread-gui-start",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      prompt: "hi",
      presentationMode: "gui",
      initialSize: {
        cols: 132,
        rows: 42,
      },
    });

    expect(adapter.buildLaunchArgv).not.toHaveBeenCalled();
    expect(ptySpawnMock).not.toHaveBeenCalled();
    expect(setListener).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledWith("hi", { model: "gpt-5.4" }, undefined, {
      userMessageItemId: expect.stringMatching(/^user-/),
    });
    expect(
      (runtime as unknown as { sessions: Map<string, { pty?: unknown }> }).sessions.get(
        "thread-gui-start",
      )?.pty,
    ).toBeUndefined();
    const threadStates = emitted.filter(
      (event) => event.type === "thread-state" && event.threadId === "thread-gui-start",
    );
    expect(threadStates[0]).toMatchObject({
      type: "thread-state",
      threadId: "thread-gui-start",
      status: "working",
      attention: "working",
      threadStatusSource: "server",
    });
    expect(threadStates).not.toContainEqual(
      expect.objectContaining({
        status: "launching",
      }),
    );
  });

  it("inserts Codex hook enable flags before the positional prompt", async () => {
    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();

    ptySpawnMock.mockReturnValueOnce(pty);

    const adapter = {
      kind: "codex" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "codex",
        args: ["--no-alt-screen", "hello"],
      })),
      buildResumeArgv: vi.fn<() => void>(),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "codex",
      adapter,
    );
    (
      runtime as unknown as {
        cliHookPluginCoordinator: {
          resolvePluginEnvForSpawn: (input: unknown) => Promise<{
            env: Record<string, string>;
            extraArgs: string[];
          }>;
        };
      }
    ).cliHookPluginCoordinator.resolvePluginEnvForSpawn = vi.fn<
      (input: unknown) => Promise<{ env: Record<string, string>; extraArgs: string[] }>
    >(async () => ({
      env: { LIGHTCODE_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event" },
      extraArgs: ["--enable", "codex_hooks"],
    }));

    await runtime.startThread({
      threadId: "thread-hook-order",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      prompt: "hello",
      initialSize: {
        cols: 120,
        rows: 30,
      },
    });

    const [, spawnArgs] = ptySpawnMock.mock.calls[0] as [string, string[]];
    const command = decodeSpawnCommand(spawnArgs);
    expect(command.indexOf("--enable")).toBeGreaterThan(-1);
    expect(command.indexOf("codex_hooks")).toBeGreaterThan(command.indexOf("--enable"));
    expect(command.indexOf("hello")).toBeGreaterThan(command.indexOf("codex_hooks"));
  });

  it("inserts Codex hook enable flags before the resume session id", async () => {
    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();

    ptySpawnMock.mockReturnValueOnce(pty);

    const adapter = {
      kind: "codex" as const,
      label: "Codex",
      capabilities: {
        models: [{ id: "gpt-5.4", label: "5.4" }],
        efforts: ["high"],
        modelEfforts: {},
        modes: ["agent"],
        approvalPolicies: [{ id: "on-request", label: "On Request" }],
        sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "terminal" as const,
        presentationMode: "terminal" as const,
      },
      detectInstall: vi.fn<() => void>(),
      buildLaunchArgv: vi.fn<() => void>(),
      buildResumeArgv: vi.fn<() => { binary: string; args: string[] }>(() => ({
        binary: "codex",
        args: ["resume", "--no-alt-screen", "session-123", "next prompt"],
      })),
      createInitialSessionRef: vi
        .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
        .mockReturnValue(undefined),
    };

    (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
      "codex",
      adapter,
    );
    (
      runtime as unknown as {
        cliHookPluginCoordinator: {
          resolvePluginEnvForSpawn: (input: unknown) => Promise<{
            env: Record<string, string>;
            extraArgs: string[];
          }>;
        };
      }
    ).cliHookPluginCoordinator.resolvePluginEnvForSpawn = vi.fn<
      (input: unknown) => Promise<{ env: Record<string, string>; extraArgs: string[] }>
    >(async () => ({
      env: { LIGHTCODE_HOOK_URL: "http://127.0.0.1:43123/v1/agent-event" },
      extraArgs: ["--enable", "codex_hooks"],
    }));

    await runtime.startThread({
      threadId: "thread-hook-resume-order",
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      agentKind: "codex",
      config: {
        model: "gpt-5.4",
      },
      sessionRef: {
        providerSessionId: "session-123",
        discoveredAt: new Date().toISOString(),
      },
      prompt: "next prompt",
      initialSize: {
        cols: 120,
        rows: 30,
      },
    });

    const [, spawnArgs] = ptySpawnMock.mock.calls[0] as [string, string[]];
    const command = decodeSpawnCommand(spawnArgs);
    expect(command.indexOf("--enable")).toBeGreaterThan(-1);
    expect(command.indexOf("codex_hooks")).toBeGreaterThan(command.indexOf("--enable"));
    expect(command.indexOf("session-123")).toBeGreaterThan(command.indexOf("codex_hooks"));
    expect(command.indexOf("next prompt")).toBeGreaterThan(command.indexOf("session-123"));
  });

  it("skips TUI parsing hooks for server-backed GUI presentation", () => {
    const runtime = new SupervisorRuntime(() => undefined);
    const pty = createMockPty();
    const detectAutoResponse = vi.fn<(text: string) => unknown>(() => null);
    const isReadyForInitialPrompt = vi.fn<(text: string) => boolean>(() => false);
    const detectTerminalStatus = vi.fn<(text: string) => unknown>(() => null);

    ptySpawnMock.mockReturnValueOnce(pty);

    (
      runtime as unknown as {
        spawnThread: (input: {
          threadId: string;
          agentKind: string;
          adapter: Record<string, unknown>;
          projectLocation: { kind: "windows"; path: string };
          config: { model: string };
          initialSize: { cols: number; rows: number };
          launchPrompt: string;
          command: { command: string; args: string[] };
        }) => unknown;
      }
    ).spawnThread({
      threadId: "thread-gui",
      agentKind: "codex",
      adapter: {
        kind: "codex",
        label: "Codex",
        capabilities: {
          models: [{ id: "gpt-5.4", label: "5.4" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "on-request", label: "On Request" }],
          sandboxModes: [{ id: "workspace-write", label: "Workspace Write" }],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "server",
          presentationMode: "gui",
        },
        createInitialSessionRef: vi
          .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
          .mockReturnValue(undefined),
        buildLaunchArgv: vi.fn<() => void>(),
        buildResumeArgv: vi.fn<() => void>(),
        detectAutoResponse,
        isReadyForInitialPrompt,
        detectTerminalStatus,
      },
      projectLocation: {
        kind: "windows",
        path: "C:\\repo",
      },
      config: {
        model: "gpt-5.4",
      },
      initialSize: {
        cols: 120,
        rows: 30,
      },
      launchPrompt: "",
      command: {
        command: "codex",
        args: [],
      },
    });

    pty.emitData("Update available!\nOpenAI Codex");

    expect(detectAutoResponse).not.toHaveBeenCalled();
    expect(isReadyForInitialPrompt).not.toHaveBeenCalled();
    expect(detectTerminalStatus).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "posix",
      projectLocation: { kind: "posix" as const, path: "/tmp/repo" },
    },
    {
      name: "windows",
      projectLocation: { kind: "windows" as const, path: "C:\\repo" },
    },
  ])(
    "passes a text + attachment prompt with special chars through to the launch arg unchanged on $name",
    async ({ projectLocation }) => {
      const runtime = new SupervisorRuntime(() => undefined);
      const pty = createMockPty();
      ptySpawnMock.mockReturnValueOnce(pty);

      const buildLaunchArgv = vi.fn<
        (location: unknown, config: unknown, prompt: string) => { binary: string; args: string[] }
      >((_location, _config, prompt) => ({
        binary: "claude",
        args: prompt.length > 0 ? ["--allow-dangerously-skip-permissions", prompt] : [],
      }));

      const adapter = {
        kind: "claude" as const,
        label: "Claude",
        capabilities: {
          models: [{ id: "opus", label: "Opus" }],
          efforts: ["high"],
          modelEfforts: {},
          modes: ["agent"],
          approvalPolicies: [{ id: "default", label: "Default" }],
          sandboxModes: [],
          supportsResume: true,
          supportsDirectInput: true,
          liveInputMode: "terminal" as const,
          presentationMode: "terminal" as const,
        },
        detectInstall: vi.fn<() => void>(),
        buildLaunchArgv,
        buildResumeArgv: vi.fn<() => void>(),
        createInitialSessionRef: vi.fn<() => undefined>().mockReturnValue(undefined),
        formatPromptSegments: (
          segments: Array<{ kind: string; content?: string; path?: string }>,
        ) => {
          const attachments = segments.filter((s) => s.kind === "attachment");
          const rest = segments.filter((s) => s.kind !== "attachment");
          const restStr = rest
            .map((s) => (s.kind === "file" ? `@${s.path}` : (s.content ?? "")))
            .join("");
          const attachmentLines = attachments.map((s) => `@${s.path}`).join(" ");
          return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
        },
      };

      (runtime as unknown as { adapters: Map<string, typeof adapter> }).adapters.set(
        "claude",
        adapter,
      );

      const spicyPrompt = "let's `do` $this\nwith 'quotes'";
      await runtime.startThread({
        threadId: "thread-prompt-quoting",
        projectLocation,
        agentKind: "claude",
        config: { model: "opus" },
        prompt: spicyPrompt,
        segments: [
          { kind: "text", content: spicyPrompt },
          { kind: "attachment", path: "/tmp/Image 1.png" },
        ],
        initialSize: { cols: 120, rows: 30 },
      });

      const formattedPrompt = `${spicyPrompt}\n\n@/tmp/Image 1.png `;
      const launchArgvCalls = buildLaunchArgv.mock.calls;
      expect(launchArgvCalls.length).toBeGreaterThan(0);
      expect(launchArgvCalls[0]![2]).toBe(formattedPrompt);

      const [, spawnArgs] = ptySpawnMock.mock.calls[0] as [string, string[]];
      const command = decodeSpawnCommand(spawnArgs);
      // Each problematic substring must survive the shell-quoting layer.
      expect(command).toContain("let");
      expect(command).toContain("do");
      expect(command).toContain("$this");
      expect(command).toContain("with");
      expect(command).toContain("quotes");
      expect(command).toContain("@/tmp/Image 1.png");
    },
  );
});

describe("detectWslAgentStatuses", () => {
  it("migrates stale cached settingDefs to current schema", () => {
    const dataDir = makeTempDir();
    process.env.LIGHTCODE_DATA_DIR = dataDir;

    const { cacheDir, statusCachePath } = resolveLightcodePaths(dataDir);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      statusCachePath,
      JSON.stringify({
        windows: [
          {
            kind: "claude",
            label: "Claude Code",
            installed: true,
            authState: "unknown",
            capabilities: {
              models: [{ id: "sonnet", label: "Sonnet" }],
              efforts: [],
              modelEfforts: {},
              modes: [],
              approvalPolicies: [],
              sandboxModes: [],
              supportsResume: true,
              supportsDirectInput: true,
              liveInputMode: "terminal",
              presentationMode: "terminal",
              settingDefs: [
                {
                  key: "legacy-toggle",
                  envVar: "CLAUDE_LEGACY_TOGGLE",
                  label: "Legacy toggle",
                  description: "Old format: no type, envVar string",
                  default: true,
                },
                {
                  key: "verbose-logging",
                  type: "toggle",
                  env: { CLAUDE_VERBOSE_LOGGING: "1" },
                  label: "Verbose logging",
                  description: "Already current format",
                  default: false,
                },
              ],
            },
          },
        ],
      }),
    );

    const emitted: unknown[] = [];
    const runtime = new SupervisorRuntime((event) => {
      emitted.push(event);
    });

    const cached = (
      runtime as unknown as {
        readCachedStatuses: (wslDistros: readonly string[]) => {
          windows: unknown[];
          wsl: unknown[];
          fromCache: boolean;
        };
      }
    ).readCachedStatuses([]);

    // Old-format entry is migrated (type: "toggle", envVar → env record).
    // Already-valid entry passes through unchanged.
    // Cache is returned from the RPC instead of emitted as an event, so the
    // renderer can hydrate synchronously on resolve.
    expect(emitted).toEqual([]);
    expect(cached).toEqual({
      fromCache: true,
      windows: [
        {
          kind: "claude",
          label: "Claude Code",
          installed: true,
          authState: "unknown",
          capabilities: {
            models: [{ id: "sonnet", label: "Sonnet" }],
            efforts: [],
            modelEfforts: {},
            modes: [],
            approvalPolicies: [],
            sandboxModes: [],
            supportsResume: true,
            supportsDirectInput: true,
            liveInputMode: "terminal",
            presentationMode: "terminal",
            settingDefs: [
              {
                key: "legacy-toggle",
                type: "toggle",
                env: { CLAUDE_LEGACY_TOGGLE: "1" },
                label: "Legacy toggle",
                description: "Old format: no type, envVar string",
                default: true,
              },
              {
                key: "verbose-logging",
                type: "toggle",
                env: { CLAUDE_VERBOSE_LOGGING: "1" },
                label: "Verbose logging",
                description: "Already current format",
                default: false,
              },
            ],
          },
        },
      ],
      wsl: [],
    });
  });

  it("detects statuses for every adapter in every distro", async () => {
    const detectInstall = vi.fn<
      (ctx?: { envKind: "windows" | "wsl"; wslDistro?: string }) => Promise<{
        kind: "codex";
        label: string;
        installed: boolean;
        authState: "unknown";
        capabilities: {
          models: [];
          efforts: [];
          modelEfforts: {};
          modes: [];
          approvalPolicies: [];
          sandboxModes: [];
          supportsResume: true;
          supportsDirectInput: true;
          liveInputMode: "server";
          presentationMode: "terminal";
          settingDefs: [];
        };
      }>
    >(async (ctx?: { envKind: "windows" | "wsl"; wslDistro?: string }) => ({
      kind: "codex" as const,
      label: `Codex ${ctx?.wslDistro ?? "windows"}`,
      installed: ctx?.wslDistro === "Ubuntu",
      authState: "unknown" as const,
      capabilities: {
        models: [],
        efforts: [],
        modelEfforts: {},
        modes: [],
        approvalPolicies: [],
        sandboxModes: [],
        supportsResume: true,
        supportsDirectInput: true,
        liveInputMode: "server" as const,
        presentationMode: "terminal" as const,
        settingDefs: [],
      },
    }));

    const statuses = await detectWslAgentStatuses(
      [
        {
          kind: "codex",
          label: "Codex",
          capabilities: {
            models: [],
            efforts: [],
            modelEfforts: {},
            modes: [],
            approvalPolicies: [],
            sandboxModes: [],
            supportsResume: true,
            supportsDirectInput: true,
            liveInputMode: "server",
            presentationMode: "terminal",
            settingDefs: [],
          },
          detectInstall,
          buildLaunchArgv: vi
            .fn<() => { binary: string; args: string[] }>()
            .mockReturnValue({ binary: "codex", args: [] }),
          buildResumeArgv: vi
            .fn<() => { binary: string; args: string[] }>()
            .mockReturnValue({ binary: "codex", args: [] }),
          createInitialSessionRef: vi
            .fn<() => { providerSessionId: string; discoveredAt: string } | undefined>()
            .mockReturnValue(undefined),
        },
      ],
      ["Ubuntu", "Debian"],
    );

    expect(detectInstall).toHaveBeenCalledTimes(2);
    expect(detectInstall).toHaveBeenNthCalledWith(1, { envKind: "wsl", wslDistro: "Ubuntu" });
    expect(detectInstall).toHaveBeenNthCalledWith(2, { envKind: "wsl", wslDistro: "Debian" });
    expect(statuses).toEqual([
      expect.objectContaining({ envKind: "wsl", envDistro: "Ubuntu", installed: true }),
      expect.objectContaining({ envKind: "wsl", envDistro: "Debian", installed: false }),
    ]);
  });
});
