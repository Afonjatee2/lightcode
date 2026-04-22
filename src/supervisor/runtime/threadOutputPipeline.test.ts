import { describe, expect, it, vi } from "vitest";
import { ThreadOutputPipeline, resolveThreadStatusSource } from "./threadOutputPipeline";
import type { SessionRuntime } from "./sessionTypes";

function pipeline() {
  return new ThreadOutputPipeline({
    emit: vi.fn<() => void>(),
    isDev: false,
    logWriter: { append: vi.fn<() => void>() } as never,
    resolveLogPath: () => "",
    resolveHintLogPath: () => "",
    onRecoverInvalidSessionRef: vi.fn<() => void>(),
    onStartQueuedLaunchPrompt: vi.fn<() => void>(),
    onStartSessionRefDiscovery: vi.fn<() => void>(),
  });
}

describe("resolveThreadStatusSource", () => {
  it("returns server when presentation is not terminal", () => {
    expect(
      resolveThreadStatusSource({
        adapter: { capabilities: { presentationMode: "gui" } },
      } as never),
    ).toBe("server");
  });

  it("returns cli_hook when the CLI hook plugin has posted", () => {
    expect(
      resolveThreadStatusSource({
        hasCliHookPluginActivity: true,
        adapter: { capabilities: { presentationMode: "terminal" } },
      } as never),
    ).toBe("cli_hook");
  });

  it("returns terminal_parse for terminal without hook activity", () => {
    expect(
      resolveThreadStatusSource({
        hasCliHookPluginActivity: false,
        adapter: { capabilities: { presentationMode: "terminal" } },
      } as never),
    ).toBe("terminal_parse");
  });

  it("returns cli_hook when LIGHTCODE_HOOK_URL was injected at spawn (before any hook POST)", () => {
    expect(
      resolveThreadStatusSource({
        cliHookEnvInjected: true,
        hasCliHookPluginActivity: false,
        adapter: { capabilities: { presentationMode: "terminal" } },
      } as never),
    ).toBe("cli_hook");
  });
});

describe("ThreadOutputPipeline / CLI hook disables L2", () => {
  it("getLatestTerminalStatusHint returns null without calling detectTerminalStatus when hook is active", () => {
    const p = pipeline();
    const detectTerminalStatus = vi.fn<
      () => { status: "working"; attention: "working"; corroborated: true }
    >(() => ({
      status: "working",
      attention: "working",
      corroborated: true,
    }));
    const session = {
      hasCliHookPluginActivity: true,
      prevChunk: "x",
      adapter: {
        capabilities: { presentationMode: "terminal" },
        detectTerminalStatus,
      },
    } as unknown as SessionRuntime;
    expect(p.getLatestTerminalStatusHint(session)).toBeNull();
    expect(detectTerminalStatus).not.toHaveBeenCalled();
  });

  it("handlePtyData skips detectTerminalStatus when hook is active", () => {
    const p = pipeline();
    const detectTerminalStatus = vi.fn<
      () => { status: "working"; attention: "working"; corroborated: true }
    >(() => ({
      status: "working",
      attention: "working",
      corroborated: true,
    }));
    const session = {
      threadId: "t1",
      status: "idle",
      attention: "none",
      config: {},
      hasCliHookPluginActivity: true,
      prevChunk: "",
      outputLength: 0,
      adapter: {
        capabilities: { presentationMode: "terminal" },
        detectTerminalStatus,
        isReadyForInitialPrompt: () => false,
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;
    p.handlePtyData(session, "tty");
    expect(detectTerminalStatus).not.toHaveBeenCalled();
  });

  it("calls detectTerminalStatus on each chunk when hook is active and adapter opts in", () => {
    const p = pipeline();
    const detectTerminalStatus = vi.fn<
      () => { status: "working"; attention: "working"; corroborated: true }
    >(() => ({
      status: "working",
      attention: "working",
      corroborated: true,
    }));
    const session = {
      threadId: "t1",
      status: "idle",
      attention: "none",
      config: {},
      hasCliHookPluginActivity: true,
      prevChunk: "",
      outputLength: 0,
      outputTranscript: { append: vi.fn<() => void>() },
      ptyOscCarry: undefined,
      adapter: {
        capabilities: { presentationMode: "terminal" },
        detectTerminalStatus,
        detectTerminalStatusOnHookPluginPtyData: true,
        isReadyForInitialPrompt: () => false,
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;
    p.handlePtyData(session, "tty");
    expect(detectTerminalStatus).toHaveBeenCalled();
  });

  it("suppresses OSC-derived status transitions when hook is active and adapter opts in", () => {
    const emit = vi.fn<() => void>();
    const p = new ThreadOutputPipeline({
      emit,
      isDev: false,
      logWriter: { append: vi.fn<() => void>() } as never,
      resolveLogPath: () => "",
      resolveHintLogPath: () => "",
      onRecoverInvalidSessionRef: vi.fn<() => void>(),
      onStartQueuedLaunchPrompt: vi.fn<() => void>(),
      onStartSessionRefDiscovery: vi.fn<() => void>(),
    });
    const handleOscNotification = vi.fn<
      () => { status: "idle"; attention: "none"; corroborated: true }
    >(() => ({ status: "idle", attention: "none", corroborated: true }));
    const session = {
      threadId: "t1",
      status: "working",
      attention: "working",
      config: {},
      hasCliHookPluginActivity: true,
      prevChunk: "",
      outputLength: 0,
      outputTranscript: { append: vi.fn<() => void>() },
      ptyOscCarry: undefined,
      adapter: {
        capabilities: { presentationMode: "terminal" },
        handleOscNotification,
        oscHintsDeferToHookPlugin: true,
        isReadyForInitialPrompt: () => false,
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;
    p.handlePtyData(session, "\x1b]9;agent-turn-complete\x07");
    expect(handleOscNotification).toHaveBeenCalled();
    expect(session.status).toBe("working");
    const emittedStates = (emit.mock.calls as unknown as Array<[{ type: string }]>)
      .map((c) => c[0])
      .filter((e) => e.type === "thread-state");
    expect(emittedStates).toHaveLength(0);
  });

  it("still applies OSC-derived status transitions when hook is active but adapter does not opt in", () => {
    const emit = vi.fn<() => void>();
    const p = new ThreadOutputPipeline({
      emit,
      isDev: false,
      logWriter: { append: vi.fn<() => void>() } as never,
      resolveLogPath: () => "",
      resolveHintLogPath: () => "",
      onRecoverInvalidSessionRef: vi.fn<() => void>(),
      onStartQueuedLaunchPrompt: vi.fn<() => void>(),
      onStartSessionRefDiscovery: vi.fn<() => void>(),
    });
    const handleOscNotification = vi.fn<
      () => { status: "idle"; attention: "none"; corroborated: true }
    >(() => ({ status: "idle", attention: "none", corroborated: true }));
    const session = {
      threadId: "t1",
      status: "working",
      attention: "working",
      config: {},
      hasCliHookPluginActivity: true,
      prevChunk: "",
      outputLength: 0,
      outputTranscript: { append: vi.fn<() => void>() },
      ptyOscCarry: undefined,
      adapter: {
        capabilities: { presentationMode: "terminal" },
        handleOscNotification,
        isReadyForInitialPrompt: () => false,
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;
    p.handlePtyData(session, "\x1b]9;agent-turn-complete\x07");
    expect(handleOscNotification).toHaveBeenCalled();
    expect(session.status).toBe("idle");
  });
});

describe("ThreadOutputPipeline / user-interrupt recovery timer", () => {
  function busySession(): SessionRuntime {
    return {
      threadId: "t1",
      status: "working",
      attention: "working",
      config: {},
      hasCliHookPluginActivity: true,
      adapter: { capabilities: { presentationMode: "terminal" } },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;
  }

  it("applyCliHookPluginState clears userInterruptRecoveryTimer so a real hook wins the race", () => {
    const p = pipeline();
    const session = busySession();
    const timer = setTimeout(() => {
      throw new Error("timer must be cancelled by applyCliHookPluginState");
    }, 10_000);
    session.userInterruptRecoveryTimer = timer;

    p.applyCliHookPluginState(session, { status: "idle", attention: "none" });

    expect(session.userInterruptRecoveryTimer).toBeUndefined();
    expect(session.status).toBe("idle");
  });

  it("clearSessionTimers clears userInterruptRecoveryTimer", () => {
    const p = pipeline();
    const session = busySession();
    session.userInterruptRecoveryTimer = setTimeout(() => {
      throw new Error("timer must be cancelled by clearSessionTimers");
    }, 10_000);

    p.clearSessionTimers(session);

    expect(session.userInterruptRecoveryTimer).toBeUndefined();
  });
});

describe("ThreadOutputPipeline / idleStrippedTail staleness watermark", () => {
  function staleRepaintSession(): SessionRuntime {
    return {
      threadId: "t1",
      status: "working",
      attention: "working",
      config: {},
      hasCliHookPluginActivity: true,
      prevChunk: "",
      outputLength: 0,
      outputTranscript: {
        append: vi.fn<() => void>(),
        readTail: () => "● Working (1s • esc to interrupt)\n",
      },
      ptyOscCarry: undefined,
      adapter: {
        capabilities: { presentationMode: "terminal" },
        detectTerminalStatus: (text: string, ctx?: { idleStrippedTail?: string }) => {
          const match = text.match(/[^\r\n]*Working\s*\(\s*\d[^\r\n]*/);
          if (!match) return null;
          if (ctx?.idleStrippedTail?.includes(match[0].trim())) return null;
          return { status: "working" as const, attention: "working" as const, corroborated: false };
        },
        detectTerminalStatusOnHookPluginPtyData: true,
        isReadyForInitialPrompt: () => false,
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;
  }

  it("does not re-flip to working when a chunk repaints the pre-idle Working line", () => {
    const p = pipeline();
    const session = staleRepaintSession();

    // 1. Hook drives us to idle — the pipeline snapshots the transcript tail
    //    (which contains `● Working (1s • esc to interrupt)`).
    p.applyCliHookPluginState(session, { status: "idle", attention: "none" });
    expect(session.status).toBe("idle");
    expect(session.idleStrippedTail).toContain("Working (1s");

    // 2. Codex repaints the TUI — chunk carries the same stale Working line.
    p.handlePtyData(session, "● Working (1s • esc to interrupt)\n");
    expect(session.status).toBe("idle");

    // 3. A genuinely fresh turn writes `(0s` — not in the snapshot — so L2
    //    flips back to working as intended.
    p.handlePtyData(session, "⠸ Working (0s • esc to interrupt)\n");
    expect(session.status).toBe("working");
    expect(session.idleStrippedTail).toBeUndefined();
  });
});
