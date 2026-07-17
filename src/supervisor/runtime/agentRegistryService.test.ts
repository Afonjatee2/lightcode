import { describe, expect, it, vi } from "vitest";
import type { AgentStatus, UpdateAgentBinaryResult } from "@/shared/contracts";
import type { AgentAdapter, AgentEnvContext } from "../agents/base";
import type { AgentStatusService } from "./agentStatusService";
import type { SupervisorSharedSettingsCache } from "./supervisorSharedSettings";

const runUpdateCommandWithFallbackMock = vi.hoisted(() =>
  vi.fn<
    (
      adapter: AgentAdapter,
      status: AgentStatus,
      envContext: AgentEnvContext,
    ) => Promise<UpdateAgentBinaryResult>
  >(),
);

vi.mock("../agents/updateAgent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/updateAgent")>();
  return {
    ...actual,
    runUpdateCommandWithFallback: runUpdateCommandWithFallbackMock,
  };
});

import { AgentRegistryService } from "./agentRegistryService";

const capabilities: AgentStatus["capabilities"] = {
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
  settingDefs: [],
};

describe("AgentRegistryService.updateAgentBinary", () => {
  it("awaits a fresh scoped WSL status before running the updater", async () => {
    const status: AgentStatus = {
      kind: "opencode",
      label: "OpenCode",
      installed: true,
      version: "1.17.7",
      executablePath: "/home/test/.opencode/bin/opencode",
      authState: "authenticated",
      capabilities,
      envKind: "wsl",
      envDistro: "Ubuntu",
    };
    const adapter = {
      kind: "opencode",
      label: "OpenCode",
      capabilities,
      detectInstall: vi.fn<AgentAdapter["detectInstall"]>(),
      buildLaunchArgv: vi.fn<AgentAdapter["buildLaunchArgv"]>(),
      buildResumeArgv: vi.fn<AgentAdapter["buildResumeArgv"]>(),
      createInitialSessionRef: vi.fn<AgentAdapter["createInitialSessionRef"]>(() => undefined),
    } as unknown as AgentAdapter;
    const refreshAgentStatuses = vi
      .fn<AgentStatusService["refreshAgentStatuses"]>()
      .mockResolvedValue({
        windows: [],
        wsl: [status],
        fromCache: false,
      });
    const getAgentStatuses = vi.fn<AgentStatusService["getAgentStatuses"]>();
    const listWslDistros = vi.fn<AgentStatusService["listWslDistros"]>();
    const agentStatusService = {
      refreshAgentStatuses,
      getAgentStatuses,
      listWslDistros,
    } as unknown as AgentStatusService;
    const service = new AgentRegistryService({
      adapters: new Map([["opencode", adapter]]),
      settingsPath: "C:\\data\\settings.json",
      baseDir: "C:\\data",
      acpIconsDir: "C:\\data\\icons",
      sharedSettingsCache: {
        invalidate: vi.fn<SupervisorSharedSettingsCache["invalidate"]>(),
      } as unknown as SupervisorSharedSettingsCache,
      getAgentStatusService: () => agentStatusService,
    });
    runUpdateCommandWithFallbackMock.mockResolvedValue({
      ok: false,
      strategy: "built-in",
      output: "command failed",
    });

    const result = await service.updateAgentBinary({
      agentKind: "opencode",
      envKind: "wsl",
      wslDistro: "Ubuntu",
    });

    expect(refreshAgentStatuses).toHaveBeenCalledWith({
      wslDistros: ["Ubuntu"],
      scope: {
        agentKinds: ["opencode"],
        envs: [{ kind: "wsl", distro: "Ubuntu" }],
      },
    });
    expect(getAgentStatuses).not.toHaveBeenCalled();
    expect(listWslDistros).not.toHaveBeenCalled();
    expect(runUpdateCommandWithFallbackMock).toHaveBeenCalledWith(adapter, status, {
      envKind: "wsl",
      wslDistro: "Ubuntu",
      baseDir: "C:\\data",
    });
    expect(result).toEqual({
      ok: false,
      strategy: "built-in",
      output: "command failed",
    });
  });

  it("refreshes every detected provider profile that resolves to the updated executable", async () => {
    const status: AgentStatus = {
      kind: "claude:work",
      label: "Claude Work",
      installed: true,
      version: "1.0.0",
      executablePath: "/usr/local/bin/claude",
      authState: "authenticated",
      capabilities,
      envKind: "posix",
    };
    const makeAdapter = (kind: AgentAdapter["kind"], label: string) =>
      ({
        kind,
        label,
        binary: "claude",
        capabilities,
        detectInstall: vi.fn<AgentAdapter["detectInstall"]>(),
        buildLaunchArgv: vi.fn<AgentAdapter["buildLaunchArgv"]>(),
        buildResumeArgv: vi.fn<AgentAdapter["buildResumeArgv"]>(),
        createInitialSessionRef: vi.fn<AgentAdapter["createInitialSessionRef"]>(() => undefined),
      }) as unknown as AgentAdapter;
    const adapters = new Map<AgentAdapter["kind"], AgentAdapter>([
      ["claude", makeAdapter("claude", "Claude Code")],
      ["claude:personal", makeAdapter("claude:personal", "Claude Personal")],
      ["claude:work", makeAdapter("claude:work", "Claude Work")],
    ]);
    const refreshAgentStatuses = vi
      .fn<AgentStatusService["refreshAgentStatuses"]>()
      .mockResolvedValue({
        windows: [
          { ...status, kind: "claude", label: "Claude Code" },
          { ...status, kind: "claude:personal", label: "Claude Personal" },
          status,
          {
            ...status,
            kind: "codex",
            label: "Codex",
            executablePath: "/usr/local/bin/codex",
          },
        ],
        wsl: [],
        fromCache: false,
      });
    const listWslDistros = vi
      .fn<AgentStatusService["listWslDistros"]>()
      .mockResolvedValue(["Ubuntu"]);
    const agentStatusService = {
      refreshAgentStatuses,
      getAgentStatuses: vi.fn<AgentStatusService["getAgentStatuses"]>(),
      listWslDistros,
    } as unknown as AgentStatusService;
    const service = new AgentRegistryService({
      adapters,
      settingsPath: "/data/settings.json",
      baseDir: "/data",
      acpIconsDir: "/data/icons",
      sharedSettingsCache: {
        invalidate: vi.fn<SupervisorSharedSettingsCache["invalidate"]>(),
      } as unknown as SupervisorSharedSettingsCache,
      getAgentStatusService: () => agentStatusService,
    });
    runUpdateCommandWithFallbackMock.mockResolvedValue({
      ok: true,
      strategy: "built-in",
      output: "updated",
    });

    await service.updateAgentBinary({ agentKind: "claude:work", envKind: "posix" });

    expect(refreshAgentStatuses).toHaveBeenNthCalledWith(2, {
      wslDistros: ["Ubuntu"],
      scope: {
        agentKinds: ["claude", "claude:personal", "claude:work"],
      },
    });
  });
});
