import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Project } from "@/shared/contracts";

const statusesState = {
  agentStatuses: [] as AgentStatus[],
  wslAgentStatuses: [] as AgentStatus[],
};

const resetDiscoveredAgentsMock = vi.fn<() => void>();
const refreshAgentStatusesMock = vi.fn<(wslDistros?: string[]) => Promise<void>>();

const appState = {
  projects: [] as Project[],
};

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
  useAgentStatusesStore.getState = () => ({
    resetDiscoveredAgents: resetDiscoveredAgentsMock,
  });
  return { useAgentStatusesStore };
});

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState),
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (state: { disabledAgents: string[] }) => unknown) =>
    selector({ disabledAgents: [] }),
}));

vi.mock("@/renderer/components/layout/PageLayout", () => ({
  PageLayout: (props: { sidebar: ReactNode; content: ReactNode }) => (
    <div>
      <aside>{props.sidebar}</aside>
      <main>{props.content}</main>
    </div>
  ),
}));

vi.mock("@/renderer/components/common", () => ({
  SidebarButton: (props: { label: string; onPress?: () => void }) => (
    <button type="button" onClick={props.onPress}>
      {props.label}
    </button>
  ),
}));

vi.mock("@/renderer/components/providers/ProviderIcon", () => ({
  ProviderIcon: () => <span />,
}));

vi.mock("@/renderer/views/MainView/parts/AppShell/AppShell", () => ({
  useSidebar: () => ({
    isCollapsed: false,
    collapse: () => undefined,
    expand: () => undefined,
  }),
}));

vi.mock("@/renderer/bridge", () => ({
  isDevApp: () => false,
  isWindows: () => false,
  readBridge: () => ({
    refreshAgentStatuses: refreshAgentStatusesMock,
  }),
}));

vi.mock("@/renderer/components/thread/AgentDiscoveryScreen", () => ({
  AgentDiscoveryScreen: () => <div>Discovering coding agents…</div>,
}));

vi.mock("./parts/GeneralSettings", () => ({
  GeneralSettings: () => <div>General</div>,
}));

vi.mock("./parts/NotificationSettings", () => ({
  NotificationSettings: () => <div>Notifications</div>,
}));

vi.mock("./parts/AISettings", () => ({
  AISettings: () => <div>AI</div>,
}));

vi.mock("./parts/SearchSettings", () => ({
  SearchSettings: () => <div>Search</div>,
}));

vi.mock("./parts/ArchivedThreadsSettings", () => ({
  ArchivedThreadsSettings: () => <div>Archived</div>,
}));

vi.mock("./parts/AboutSettings", () => ({
  AboutSettings: () => <div>About</div>,
}));

vi.mock("./parts/DevSettings", () => ({
  DevSettings: () => <div>Dev</div>,
}));

vi.mock("./parts/SingleAgentSettings", () => ({
  AgentSettingsEmpty: () => <div>No agents installed.</div>,
  SingleAgentSettings: (props: { agentKind: string }) => <div>Agent {props.agentKind}</div>,
}));

import { SettingsOverlay } from "./SettingsOverlay";

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

describe("SettingsOverlay", () => {
  beforeEach(() => {
    statusesState.agentStatuses = [];
    statusesState.wslAgentStatuses = [];
    appState.projects = [];
    resetDiscoveredAgentsMock.mockReset();
    refreshAgentStatusesMock.mockReset();
    refreshAgentStatusesMock.mockResolvedValue(undefined);
  });

  it("keeps WSL-only installed agents reachable from the sidebar", () => {
    statusesState.wslAgentStatuses = [
      makeStatus("gemini", {
        label: "Gemini",
        envKind: "wsl",
        envDistro: "Ubuntu",
      }),
    ];

    render(<SettingsOverlay onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    expect(screen.getByRole("button", { name: "Gemini" })).toBeInTheDocument();
    expect(screen.getByText("Agent gemini")).toBeInTheDocument();
  });

  it("refreshes agent probing from the agents sidebar and shows the discovery overlay", async () => {
    statusesState.agentStatuses = [
      makeStatus("claude", {
        label: "Claude Code",
        envKind: "posix",
      }),
    ];
    appState.projects = [
      {
        id: "project-1",
        name: "demo",
        disabled: false,
        createdAt: new Date(0).toISOString(),
        location: {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/demo/project",
          uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\project",
        },
      },
    ];

    let resolveRefresh: (() => void) | undefined;
    refreshAgentStatusesMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    render(<SettingsOverlay onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh detected agents" }));

    expect(resetDiscoveredAgentsMock).toHaveBeenCalledTimes(1);
    expect(refreshAgentStatusesMock).toHaveBeenCalledWith(["Ubuntu"]);
    expect(screen.getByText("Discovering coding agents…")).toBeInTheDocument();

    resolveRefresh?.();

    await waitFor(() => {
      expect(screen.queryByText("Discovering coding agents…")).not.toBeInTheDocument();
    });
  });
});
