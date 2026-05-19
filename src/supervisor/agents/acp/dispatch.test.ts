import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAdapter, CommandSpec } from "../base";
import { dispatchAcpAuthenticate, dispatchAcpLogout } from "./dispatch";

const authenticateAcpAgentMock = vi.hoisted(() =>
  vi.fn<
    (
      command: string,
      args: string[],
      methodId: string,
      options?: {
        processCwd?: string;
        env?: Record<string, string>;
        label?: string;
        timeoutMs?: number;
      },
    ) => Promise<void>
  >(),
);
const readCommandOutputAsyncMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>>(),
);
const logoutAcpAgentMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>());

vi.mock("./probe", () => ({
  authenticateAcpAgent: authenticateAcpAgentMock,
  logoutAcpAgent: logoutAcpAgentMock,
}));

vi.mock("../base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../base")>();
  return {
    ...actual,
    readCommandOutputAsync: readCommandOutputAsyncMock,
  };
});

function makeAdapter(command: CommandSpec, overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    kind: "cursor",
    label: "Cursor",
    binary: "cursor-agent",
    capabilities: {
      models: [],
      efforts: [],
      modelEfforts: {},
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      presentationModes: ["terminal", "gui"],
      settingDefs: [],
    },
    async detectInstall() {
      throw new Error("not used");
    },
    buildLaunchArgv() {
      throw new Error("not used");
    },
    buildResumeArgv() {
      throw new Error("not used");
    },
    async buildAcpAuthCommand() {
      return command;
    },
    createInitialSessionRef() {
      return undefined;
    },
    ...overrides,
  };
}

describe("dispatchAcpAuthenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateAcpAgentMock.mockResolvedValue(undefined);
    logoutAcpAgentMock.mockResolvedValue(undefined);
    readCommandOutputAsyncMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
  });

  it("injects the native browser launcher into WSL ACP auth commands", async () => {
    await dispatchAcpAuthenticate({
      adapter: makeAdapter({
        command: "C:\\Windows\\System32\\wsl.exe",
        args: [
          "-d",
          "Ubuntu",
          "--cd",
          "/tmp",
          "--",
          "/bin/bash",
          "-l",
          "-i",
          "-c",
          "exec 'cursor-agent' 'acp'",
        ],
      }),
      methodId: "browser-login",
      envKind: "wsl",
      wslDistro: "Ubuntu",
    });

    const [command, args, methodId, options] = authenticateAcpAgentMock.mock.calls[0]!;
    expect(command).toMatch(/wsl(?:\.exe)?$/u);
    expect(methodId).toBe("browser-login");
    expect(args.at(-1)).toContain("export BROWSER='cmd.exe /c start \"\"'");
    expect(args.at(-1)).toContain("exec 'cursor-agent' 'acp'");
    expect(options).not.toHaveProperty("env");
  });

  it("does not re-inject command env that is already baked into WSL auth commands", async () => {
    await dispatchAcpAuthenticate({
      adapter: makeAdapter({
        command: "C:\\Windows\\System32\\wsl.exe",
        args: [
          "-d",
          "Ubuntu",
          "--cd",
          "/tmp",
          "--",
          "/bin/bash",
          "-l",
          "-i",
          "-c",
          "export CURSOR_CONFIG='/tmp/config'; exec 'cursor-agent' 'acp'",
        ],
        env: { CURSOR_CONFIG: "/tmp/config" },
      }),
      methodId: "browser-login",
      envKind: "wsl",
      wslDistro: "Ubuntu",
    });

    const [, args] = authenticateAcpAgentMock.mock.calls[0]!;
    const script = String(args.at(-1));
    expect(script.match(/export CURSOR_CONFIG=/gu)).toHaveLength(1);
    expect(script).toContain("export BROWSER='cmd.exe /c start \"\"'");
  });
});

describe("dispatchAcpLogout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logoutAcpAgentMock.mockResolvedValue(undefined);
    readCommandOutputAsyncMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
  });

  it("dispatches adapter-provided logout commands", async () => {
    await dispatchAcpLogout({
      adapter: makeAdapter(
        { command: "cursor-agent", args: ["acp"] },
        {
          async buildAcpLogoutCommand() {
            return { command: "cursor-agent", args: ["logout"], cwd: "C:\\repo" };
          },
        },
      ),
      envKind: "windows",
    });

    expect(readCommandOutputAsyncMock).toHaveBeenCalledWith("cursor-agent", ["logout"], {
      cwd: "C:\\repo",
    });
  });

  it("throws when the adapter returns no logout command", async () => {
    await expect(
      dispatchAcpLogout({
        adapter: makeAdapter(
          { command: "cursor-agent", args: ["acp"] },
          { buildAcpLogoutCommand: async () => undefined },
        ),
        envKind: "windows",
      }),
    ).rejects.toThrow("did not return an ACP logout command");
  });
});
