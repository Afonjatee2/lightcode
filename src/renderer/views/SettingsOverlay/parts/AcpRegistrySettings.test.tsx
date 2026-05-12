import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpRegistryListResult, AgentStatus, Project } from "@/shared/contracts";

const statusesState = {
  agentStatuses: [] as AgentStatus[],
  wslAgentStatuses: [] as AgentStatus[],
};

const appState = {
  projects: [] as Project[],
};

const settingsState = {
  acpRegistryInstalledAgents: {} as Record<string, unknown>,
};

const bridge = {
  platform: "darwin" as NodeJS.Platform,
  listAcpRegistry: vi.fn<() => Promise<AcpRegistryListResult>>(),
  refreshAgentStatuses: vi.fn<() => Promise<void>>(),
  installAcpRegistryAgent: vi.fn<(payload: { agentId: string }) => Promise<{ installed: [] }>>(),
  removeAcpRegistryAgent: vi.fn<(payload: { agentId: string }) => Promise<{ installed: [] }>>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
};

const runAgentTerminalCommandMock = vi.hoisted(() => vi.fn<(input: unknown) => void>());
const runAgentLoginCommandMock = vi.hoisted(() => vi.fn<(input: unknown) => void>());
const resetDiscoveredAgentsMock = vi.hoisted(() => vi.fn<() => void>());

vi.mock("@/renderer/state/agentStatusesStore", () => {
  const useAgentStatusesStore = (
    selector: (state: {
      agentStatuses: AgentStatus[];
      wslAgentStatuses: AgentStatus[];
      resetDiscoveredAgents: () => void;
    }) => unknown,
  ) =>
    selector({
      ...statusesState,
      resetDiscoveredAgents: resetDiscoveredAgentsMock,
    });
  useAgentStatusesStore.getState = () => ({ resetDiscoveredAgents: resetDiscoveredAgentsMock });
  return { useAgentStatusesStore };
});

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState),
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (state: typeof settingsState) => unknown) =>
    selector(settingsState),
}));

vi.mock("@/renderer/bridge", () => ({
  isWindows: () => bridge.platform === "win32",
  readBridge: () => bridge,
}));

vi.mock("@/renderer/actions/agentLoginActions", () => ({
  runAgentLoginCommand: runAgentLoginCommandMock,
  runAgentTerminalCommand: runAgentTerminalCommandMock,
}));

vi.mock("@/renderer/components/common", () => ({
  PixelLoader: () => <span data-testid="loader" />,
}));

vi.mock("@/renderer/components/providers/ProviderIcon", () => ({
  ProviderIcon: (props: { fallbackLabel?: string }) => <span>{props.fallbackLabel}</span>,
}));

import { AcpRegistrySettings } from "./AcpRegistrySettings";

const baseCapabilities = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: [],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal" as const,
  presentationMode: "terminal" as const,
  settingDefs: [],
};

function makeStatus(kind: AgentStatus["kind"], input: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind,
    label: kind,
    installed: true,
    authState: "authenticated",
    capabilities: baseCapabilities,
    ...input,
  };
}

function makeProject(input: { id: string; name: string; location: Project["location"] }): Project {
  return {
    id: input.id,
    name: input.name,
    disabled: false,
    createdAt: new Date(0).toISOString(),
    location: input.location,
  };
}

const registry: AcpRegistryListResult = {
  version: "1.0.0",
  agents: [
    {
      id: "codex-acp",
      name: "Codex ACP",
      version: "1.0.0",
      description: "Codex through ACP",
      distribution: { npx: { package: "codex-acp" } },
    },
    {
      id: "glm-acp-agent",
      name: "GLM Agent",
      version: "1.1.3",
      description: "GLM through ACP",
      distribution: { npx: { package: "glm-acp-agent" } },
    },
    {
      id: "cursor",
      name: "Cursor",
      version: "1.0.0",
      description: "Cursor through ACP",
      distribution: { npx: { package: "cursor-acp" } },
    },
  ],
};

describe("AcpRegistrySettings", () => {
  beforeEach(() => {
    bridge.platform = "darwin";
    statusesState.agentStatuses = [];
    statusesState.wslAgentStatuses = [];
    appState.projects = [];
    settingsState.acpRegistryInstalledAgents = {};
    bridge.listAcpRegistry.mockReset().mockResolvedValue(registry);
    bridge.refreshAgentStatuses.mockReset().mockResolvedValue(undefined);
    bridge.installAcpRegistryAgent.mockReset().mockResolvedValue({ installed: [] });
    bridge.removeAcpRegistryAgent.mockReset().mockResolvedValue({ installed: [] });
    bridge.openExternal.mockReset().mockResolvedValue(undefined);
    runAgentLoginCommandMock.mockReset();
    runAgentTerminalCommandMock.mockReset();
    resetDiscoveredAgentsMock.mockReset();
  });

  it("shows detected native providers without offering a native install", async () => {
    statusesState.agentStatuses = [
      makeStatus("codex", {
        label: "Codex",
        version: "0.130.0",
        envKind: "posix",
      }),
    ];

    render(<AcpRegistrySettings />);

    await screen.findByRole("heading", { name: "Agent Registry" });
    const codexCard = screen.getByText(/First-class Codex CLI integration/u).closest(".rounded-lg");
    expect(codexCard).toBeTruthy();
    expect(within(codexCard as HTMLElement).getByText("Detected")).toBeInTheDocument();
    expect(within(codexCard as HTMLElement).queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("hides native-preferred ACP wrappers and tags app-supported ACP agents", async () => {
    render(<AcpRegistrySettings />);

    await screen.findByRole("heading", { name: "Agent Registry" });
    expect(screen.queryByText("Codex ACP")).not.toBeInTheDocument();
    expect(screen.getAllByText("GLM Agent").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Show advanced ACP" })).toBeNull();

    const cursorCard = screen.getAllByText("Cursor")[0]?.closest(".rounded-lg");
    expect(cursorCard).toBeTruthy();
    expect(within(cursorCard as HTMLElement).getByText("Native support")).toBeInTheDocument();
  });

  it("opens native install commands in the terminal", async () => {
    render(<AcpRegistrySettings />);

    await screen.findByRole("heading", { name: "Agent Registry" });
    const codexCard = screen.getByText(/First-class Codex CLI integration/u).closest(".rounded-lg");
    expect(codexCard).toBeTruthy();

    fireEvent.click(within(codexCard as HTMLElement).getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(runAgentTerminalCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "Codex",
          tabPurpose: "install",
        }),
      );
    });
  });

  it("uses project-backed WSL targets on Windows", async () => {
    bridge.platform = "win32";
    const wslProject = makeProject({
      id: "wsl-project",
      name: "WSL Project",
      location: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/demo/project",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\project",
      },
    });
    appState.projects = [wslProject];

    render(<AcpRegistrySettings />);

    await screen.findByRole("heading", { name: "Agent Registry" });
    const codexCard = screen.getByText(/First-class Codex CLI integration/u).closest(".rounded-lg");
    expect(codexCard).toBeTruthy();

    fireEvent.click(
      within(codexCard as HTMLElement).getByRole("button", {
        name: "Install in WSL: Ubuntu",
      }),
    );

    await waitFor(() => {
      expect(runAgentTerminalCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "Codex",
          project: wslProject,
          tabPurpose: "install",
        }),
      );
    });
  });

  it("shows WSL detection separately from local detection", async () => {
    bridge.platform = "win32";
    appState.projects = [
      makeProject({
        id: "wsl-project",
        name: "WSL Project",
        location: {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/demo/project",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\project",
        },
      }),
    ];
    statusesState.wslAgentStatuses = [
      makeStatus("codex", {
        label: "Codex WSL",
        envKind: "wsl",
        envDistro: "Ubuntu",
      }),
    ];

    render(<AcpRegistrySettings />);

    await screen.findByRole("heading", { name: "Agent Registry" });
    const codexCard = screen.getByText(/First-class Codex CLI integration/u).closest(".rounded-lg");
    expect(codexCard).toBeTruthy();
    expect(within(codexCard as HTMLElement).getByText("WSL (Ubuntu)")).toBeInTheDocument();
    expect(
      within(codexCard as HTMLElement).queryByRole("button", {
        name: "Install in WSL: Ubuntu",
      }),
    ).toBeNull();
  });

  it("opens missing-auth WSL login commands in the matching WSL project", async () => {
    bridge.platform = "win32";
    const wslProject = makeProject({
      id: "wsl-project",
      name: "WSL Project",
      location: {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/demo/project",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\project",
      },
    });
    appState.projects = [wslProject];
    statusesState.wslAgentStatuses = [
      makeStatus("codex", {
        label: "Codex WSL",
        authState: "missing",
        loginCommand: "codex login",
        envKind: "wsl",
        envDistro: "Ubuntu",
      }),
    ];

    render(<AcpRegistrySettings />);

    await screen.findByRole("heading", { name: "Agent Registry" });
    const codexCard = screen.getByText(/First-class Codex CLI integration/u).closest(".rounded-lg");
    expect(codexCard).toBeTruthy();

    fireEvent.click(within(codexCard as HTMLElement).getByRole("button", { name: "Login" }));

    expect(runAgentLoginCommandMock).toHaveBeenCalledWith({
      label: "Codex WSL",
      command: "codex login",
      project: wslProject,
    });
  });
});
