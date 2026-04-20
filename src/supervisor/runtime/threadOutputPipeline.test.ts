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
