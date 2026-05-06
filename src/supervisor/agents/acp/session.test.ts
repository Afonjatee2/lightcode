import { describe, expect, it, vi } from "vitest";
import type { CreateStructuredSessionInput } from "../base";
import type { ThreadConfig } from "@/shared/contracts";
import {
  AcpStructuredSession,
  resolveAcpResourcePath,
  shouldSpawnAcpSession,
  toAcpResourceUri,
} from "./session";

function makeInput(
  overrides: Partial<CreateStructuredSessionInput> = {},
): CreateStructuredSessionInput {
  return {
    threadId: "thread-1",
    projectLocation: { kind: "windows", path: "C:\\repo" },
    config: { model: "test-model" },
    ...overrides,
  };
}

type TestableAcpSession = {
  applyTurnConfig(config: ThreadConfig): Promise<void>;
  interruptTurn(): Promise<void>;
  handleSessionUpdate(params: { update: unknown }): void;
};

function makeConfigSyncSession(
  overrides: {
    availableModeIds?: string[];
    currentConfig?: ThreadConfig;
  } = {},
) {
  const connection = {
    setSessionMode: vi
      .fn<(args: { sessionId: string; modeId: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    unstable_setSessionModel: vi
      .fn<(args: { sessionId: string; modelId: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    setSessionConfigOption: vi
      .fn<(args: { sessionId: string; configId: string; value: string }) => Promise<void>>()
      .mockResolvedValue(undefined),
    cancel: vi.fn<(args: { sessionId: string }) => Promise<void>>().mockResolvedValue(undefined),
  };
  const listener = {
    onClose: vi.fn<() => void>(),
    onError: vi.fn<(message: string) => void>(),
    onServerRequest: vi.fn<(request: unknown) => void>(),
    onUpdate: vi.fn<(update: unknown) => void>(),
    onRuntimeEvent: vi.fn<(event: unknown) => void>(),
  };
  const session = Object.create(AcpStructuredSession.prototype) as Record<string, unknown>;
  session["connection"] = connection;
  session["sessionId"] = "session-1";
  session["threadId"] = "thread-1";
  session["listener"] = listener;
  session["availableModeIds"] = overrides.availableModeIds ?? [
    "default",
    "plan",
    "yolo",
    "autoEdit",
    "autopilot",
  ];
  session["thoughtLevelConfigId"] = "thought-level";
  session["currentConfig"] = overrides.currentConfig ?? {
    model: "model-a",
    effort: "low",
    mode: "agent",
    approvalPolicy: "default",
  };
  session["bufferedRuntimeEvents"] = [];
  session["isReplayingHistory"] = false;
  session["pendingPermissionResolvers"] = new Map();
  return { connection, listener, session: session as unknown as TestableAcpSession };
}

describe("shouldSpawnAcpSession — shared resume/presentation gate for all ACP adapters", () => {
  it("skips spawn on terminal-mode resume (TUI re-attaches itself)", () => {
    expect(
      shouldSpawnAcpSession(
        makeInput({
          sessionRef: { providerSessionId: "ses_1", discoveredAt: new Date().toISOString() },
          presentationMode: "terminal",
        }),
      ),
    ).toBe(false);
  });

  it("skips spawn on resume when presentation mode is omitted (defaults to terminal behavior)", () => {
    expect(
      shouldSpawnAcpSession(
        makeInput({
          sessionRef: { providerSessionId: "ses_1", discoveredAt: new Date().toISOString() },
        }),
      ),
    ).toBe(false);
  });

  it("spawns on GUI resume so loadSession can re-attach the chat surface", () => {
    expect(
      shouldSpawnAcpSession(
        makeInput({
          sessionRef: { providerSessionId: "ses_1", discoveredAt: new Date().toISOString() },
          presentationMode: "gui",
        }),
      ),
    ).toBe(true);
  });

  it("spawns on a fresh launch in either presentation mode", () => {
    expect(shouldSpawnAcpSession(makeInput({ presentationMode: "gui" }))).toBe(true);
    expect(shouldSpawnAcpSession(makeInput({ presentationMode: "terminal" }))).toBe(true);
    expect(shouldSpawnAcpSession(makeInput())).toBe(true);
  });
});

describe("ACP resource path helpers", () => {
  it("resolves repo-relative paths against the project root", () => {
    expect(
      resolveAcpResourcePath({ kind: "windows", path: "C:\\repo" }, ".agents/docs/ui-patterns.md"),
    ).toBe("C:\\repo\\.agents\\docs\\ui-patterns.md");
    expect(
      resolveAcpResourcePath(
        {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/me/repo",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\repo",
        },
        ".agents/docs/ui-patterns.md",
      ),
    ).toBe("/home/me/repo/.agents/docs/ui-patterns.md");
  });

  it("keeps Windows absolute image paths host-readable in WSL sessions", () => {
    expect(
      resolveAcpResourcePath(
        {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/me/repo",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\repo",
        },
        "C:\\Users\\me\\Pictures\\diagram.png",
      ),
    ).toBe("C:\\Users\\me\\Pictures\\diagram.png");
  });

  it("builds ACP-safe file URIs for relative paths", () => {
    expect(
      toAcpResourceUri({ kind: "windows", path: "C:\\repo" }, ".agents/docs/ui patterns.md"),
    ).toBe("file:///C:/repo/.agents/docs/ui%20patterns.md");
    expect(
      toAcpResourceUri(
        {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/me/repo",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\me\\repo",
        },
        ".agents/docs/ui patterns.md",
      ),
    ).toBe("file:///home/me/repo/.agents/docs/ui%20patterns.md");
  });
});

describe("ACP turn config sync", () => {
  it("applies model, mode, and effort changes before a new turn", async () => {
    const { connection, session } = makeConfigSyncSession();

    await session.applyTurnConfig({
      model: "model-b",
      effort: "high",
      mode: "plan",
      approvalPolicy: "default",
    });

    expect(connection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "session-1",
      modeId: "plan",
    });
    expect(connection.unstable_setSessionModel).toHaveBeenCalledWith({
      sessionId: "session-1",
      modelId: "model-b",
    });
    expect(connection.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "thought-level",
      value: "high",
    });
  });

  it("falls back to ACP autopilot mode when approvals change but yolo is unavailable", async () => {
    const { connection, session } = makeConfigSyncSession({
      availableModeIds: ["default", "autopilot"],
    });

    await session.applyTurnConfig({
      model: "model-a",
      effort: "low",
      mode: "agent",
      approvalPolicy: "never",
    });

    expect(connection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "session-1",
      modeId: "autopilot",
    });
  });

  it("maps ACP autopilot updates back to agent approval config", () => {
    const { listener, session } = makeConfigSyncSession({
      currentConfig: {
        model: "model-a",
        effort: "low",
        mode: "agent",
        approvalPolicy: "default",
      },
    });

    session.handleSessionUpdate({
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: "autopilot",
      },
    });

    expect(listener.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          mode: "agent",
          approvalPolicy: "never",
        }),
      }),
    );
  });

  it("cancels active ACP turns", async () => {
    const { connection, session } = makeConfigSyncSession();

    await session.interruptTurn();

    expect(connection.cancel).toHaveBeenCalledWith({ sessionId: "session-1" });
  });
});
