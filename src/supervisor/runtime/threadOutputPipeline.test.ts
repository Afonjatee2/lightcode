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
    readDisableCliHookPlugin: () => false,
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

  it("returns terminal_parse when dev toggle disables L1, even with hook env injected", () => {
    expect(
      resolveThreadStatusSource(
        {
          cliHookEnvInjected: true,
          hasCliHookPluginActivity: true,
          adapter: { capabilities: { presentationMode: "terminal" } },
        } as never,
        true,
      ),
    ).toBe("terminal_parse");
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

  it("allows hook-active terminal fallback when the adapter opts into an attention hint", () => {
    const p = pipeline();
    const detectTerminalStatus = vi.fn<
      () => { status: "needs_reply"; attention: "needs_reply"; corroborated: true }
    >(() => ({
      status: "needs_reply",
      attention: "needs_reply",
      corroborated: true,
    }));
    const session = {
      threadId: "t1",
      status: "working",
      attention: "working",
      config: {},
      cliHookEnvInjected: true,
      prevChunk: "",
      outputLength: 0,
      adapter: {
        capabilities: { presentationMode: "terminal" },
        detectTerminalStatus,
        shouldApplyTerminalStatusWhileHookActive: (hint: { status: string }) =>
          hint.status === "needs_reply" || hint.status === "needs_approval",
        isReadyForInitialPrompt: () => false,
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;

    p.handlePtyData(session, "Enter to select");

    expect(detectTerminalStatus).toHaveBeenCalled();
    expect(session.status).toBe("needs_reply");
    expect(session.attention).toBe("needs_reply");
  });

  it("does not apply hook-active terminal fallback for disallowed hints", () => {
    const p = pipeline();
    const detectTerminalStatus = vi.fn<
      () => { status: "idle"; attention: "none"; corroborated: true }
    >(() => ({
      status: "idle",
      attention: "none",
      corroborated: true,
    }));
    const session = {
      threadId: "t1",
      status: "working",
      attention: "working",
      config: {},
      cliHookEnvInjected: true,
      prevChunk: "",
      outputLength: 0,
      adapter: {
        capabilities: { presentationMode: "terminal" },
        detectTerminalStatus,
        shouldApplyTerminalStatusWhileHookActive: (hint: { status: string }) =>
          hint.status === "needs_reply" || hint.status === "needs_approval",
        isReadyForInitialPrompt: () => false,
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;

    p.handlePtyData(session, "◇ Ready");

    expect(detectTerminalStatus).toHaveBeenCalled();
    expect(session.status).toBe("working");
    expect(session.attention).toBe("working");
  });

  it("suppresses OSC-derived status transitions when hook is active and adapter opts in", () => {
    const emit = vi.fn<() => void>();
    const p = new ThreadOutputPipeline({
      emit,
      isDev: false,
      logWriter: { append: vi.fn<() => void>() } as never,
      resolveLogPath: () => "",
      resolveHintLogPath: () => "",
      readDisableCliHookPlugin: () => false,
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

  it("suppresses OSC-derived status transitions when hook is active even without adapter opt-in", () => {
    const emit = vi.fn<() => void>();
    const p = new ThreadOutputPipeline({
      emit,
      isDev: false,
      logWriter: { append: vi.fn<() => void>() } as never,
      resolveLogPath: () => "",
      resolveHintLogPath: () => "",
      readDisableCliHookPlugin: () => false,
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
    expect(session.status).toBe("working");
    const emittedStates = (emit.mock.calls as unknown as Array<[{ type: string }]>)
      .map((c) => c[0])
      .filter((e) => e.type === "thread-state");
    expect(emittedStates).toHaveLength(0);
  });

  it("suppresses OSC-derived status transitions when hook env was injected before the first hook POST", () => {
    const emit = vi.fn<() => void>();
    const p = new ThreadOutputPipeline({
      emit,
      isDev: false,
      logWriter: { append: vi.fn<() => void>() } as never,
      resolveLogPath: () => "",
      resolveHintLogPath: () => "",
      readDisableCliHookPlugin: () => false,
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
      cliHookEnvInjected: true,
      prevChunk: "",
      outputLength: 0,
      outputTranscript: { append: vi.fn<() => void>() },
      ptyOscCarry: "",
      adapter: {
        capabilities: { presentationMode: "terminal" },
        handleOscNotification,
        handleOscTitle: () => null,
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

  it("ignores launch-time working titles for empty resumes so the restored thread can settle idle", () => {
    const p = pipeline();
    const session = {
      threadId: "t1",
      status: "launching",
      attention: "none",
      config: {},
      launchPrompt: "",
      prevChunk: "",
      outputLength: 0,
      ptyOscCarry: "",
      adapter: {
        capabilities: { presentationMode: "terminal" },
        handleOscTitle: () => ({
          status: "working" as const,
          attention: "working" as const,
          corroborated: true,
        }),
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;

    p.handlePtyData(session, "\x1b]0;⠋ Working (2s • esc to interrupt)\x07OpenAI Codex");

    expect(session.status).toBe("idle");
    expect(session.attention).toBe("none");
  });

  it("still allows launch-time working titles when the launch already has queued work", () => {
    const p = pipeline();
    const session = {
      threadId: "t1",
      status: "launching",
      attention: "none",
      config: {},
      launchPrompt: "",
      pendingLaunchPrompt: "Fix the bug",
      prevChunk: "",
      outputLength: 0,
      ptyOscCarry: "",
      adapter: {
        capabilities: { presentationMode: "terminal" },
        handleOscTitle: () => ({
          status: "working" as const,
          attention: "working" as const,
          corroborated: true,
        }),
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;

    p.handlePtyData(session, "\x1b]0;⠋ Working (2s • esc to interrupt)\x07OpenAI Codex");

    expect(session.status).toBe("working");
    expect(session.attention).toBe("working");
  });

  it("ignores Codex spinner titles while hook env is present and no hook event has landed yet", () => {
    const p = pipeline();
    const session = {
      threadId: "t1",
      status: "idle",
      attention: "none",
      config: {},
      cliHookEnvInjected: true,
      launchPrompt: "",
      prevChunk: "",
      outputLength: 0,
      ptyOscCarry: "",
      adapter: {
        capabilities: { presentationMode: "terminal" },
        handleOscTitle: () => ({
          status: "working" as const,
          attention: "working" as const,
          corroborated: true,
        }),
      },
      pty: { write: vi.fn<(data: string) => void>() },
    } as unknown as SessionRuntime;

    p.handlePtyData(session, "\x1b]0;⠴ lightcode\x07");

    expect(session.status).toBe("idle");
    expect(session.attention).toBe("none");
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
