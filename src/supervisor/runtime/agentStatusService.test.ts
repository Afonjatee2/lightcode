import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import type { AgentAdapter } from "../agents/base";

vi.mock("../agents/base", async (importActual) => {
  const actual = await importActual<typeof import("../agents/base")>();
  return {
    ...actual,
    primeExecutablePathCache: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
});

import { AgentStatusService } from "./agentStatusService";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lightcode-agent-status-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

function makeStatus(): AgentStatus {
  return {
    kind: "codex",
    label: "Codex",
    installed: true,
    authState: "authenticated",
    capabilities,
  };
}

function makeService(detectInstall: AgentAdapter["detectInstall"]): {
  service: AgentStatusService;
  statusCachePath: string;
} {
  const dir = makeTempDir();
  const statusCachePath = join(dir, "agent-statuses.json");
  const adapter = {
    kind: "codex",
    label: "Codex",
    capabilities,
    detectInstall,
    buildLaunchArgv: vi.fn<AgentAdapter["buildLaunchArgv"]>(),
    buildResumeArgv: vi.fn<AgentAdapter["buildResumeArgv"]>(),
    createInitialSessionRef: vi.fn<AgentAdapter["createInitialSessionRef"]>(() => undefined),
  } as unknown as AgentAdapter;

  return {
    service: new AgentStatusService({
      adapters: new Map([["codex", adapter]]),
      settingsPath: join(dir, "settings.json"),
      statusCachePath,
      emit: vi.fn<(event: SupervisorEvent) => void>(),
    }),
    statusCachePath,
  };
}

describe("AgentStatusService", () => {
  it("runs automatic startup detection only once across status reads", async () => {
    const detectInstall = vi.fn<AgentAdapter["detectInstall"]>().mockResolvedValue(makeStatus());
    const { service, statusCachePath } = makeService(detectInstall);

    const first = await service.getAgentStatuses({ wslDistros: [] });

    expect(first.fromCache).toBe(false);
    await vi.waitFor(() => {
      expect(detectInstall).toHaveBeenCalledTimes(1);
      expect(existsSync(statusCachePath)).toBe(true);
    });

    const second = await service.getAgentStatuses({ wslDistros: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(second.fromCache).toBe(true);
    expect(detectInstall).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit refresh able to probe again", async () => {
    const detectInstall = vi.fn<AgentAdapter["detectInstall"]>().mockResolvedValue(makeStatus());
    const { service } = makeService(detectInstall);

    await service.getAgentStatuses({ wslDistros: [] });
    await vi.waitFor(() => {
      expect(detectInstall).toHaveBeenCalledTimes(1);
    });

    await service.refreshAgentStatuses({ wslDistros: [] });

    expect(detectInstall).toHaveBeenCalledTimes(2);
  });

  it("does not auto-probe after an explicit refresh already ran", async () => {
    const detectInstall = vi.fn<AgentAdapter["detectInstall"]>().mockResolvedValue(makeStatus());
    const { service } = makeService(detectInstall);

    await service.refreshAgentStatuses({ wslDistros: [] });
    await service.getAgentStatuses({ wslDistros: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(detectInstall).toHaveBeenCalledTimes(1);
  });
});
