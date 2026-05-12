import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Project } from "@/shared/contracts";

const statusesState = {
  agentStatuses: [] as AgentStatus[],
  wslAgentStatuses: [] as AgentStatus[],
};

const sharedSettingsState = {
  disabledAgents: [] as string[],
  hiddenModels: {} as Record<string, string[]>,
  agentSettings: {} as Record<string, Record<string, unknown>>,
  setAgentDisabled: vi.fn<(kind: string, disabled: boolean) => void>(),
  setHiddenModels: vi.fn<(kind: string, hidden: string[]) => void>(),
  setAgentSetting: vi.fn<(kind: string, key: string, value: unknown) => void>(),
};

const appState = {
  projects: [] as Project[],
};

vi.mock("@heroui/react", () => {
  function Button(props: { children?: ReactNode; onPress?: () => void }) {
    return (
      <button type="button" onClick={props.onPress}>
        {props.children}
      </button>
    );
  }

  function Switch(props: {
    children?: ReactNode;
    isSelected?: boolean;
    onChange?: (selected: boolean) => void;
  }) {
    return (
      <label>
        <input
          type="checkbox"
          checked={props.isSelected}
          onChange={(event) => props.onChange?.(event.target.checked)}
        />
        {props.children}
      </label>
    );
  }
  Switch.Control = (props: { children?: ReactNode }) => <span>{props.children}</span>;
  Switch.Thumb = () => <span />;

  function Wrapper(props: { children?: ReactNode }) {
    return <div>{props.children}</div>;
  }

  function ListBox(props: { children?: ReactNode }) {
    return <div>{props.children}</div>;
  }
  ListBox.Item = (props: { children?: ReactNode }) => <div>{props.children}</div>;
  ListBox.ItemIndicator = () => <span />;

  const Popover = Wrapper as typeof Wrapper & {
    Trigger: typeof Wrapper;
    Content: typeof Wrapper;
    Dialog: typeof Wrapper;
  };
  Popover.Trigger = Wrapper;
  Popover.Content = Wrapper;
  Popover.Dialog = Wrapper;

  return {
    Button,
    Label: (props: { children?: ReactNode }) => <span>{props.children}</span>,
    ListBox,
    ListLayout: () => null,
    Popover,
    Switch,
    Virtualizer: Wrapper,
  };
});

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    refreshAgentStatuses: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}));

const runAgentLoginCommandMock = vi.hoisted(() =>
  vi.fn<(input: { label: string; command: string; project?: Project }) => void>(),
);

vi.mock("@/renderer/actions/agentLoginActions", () => ({
  runAgentLoginCommand: runAgentLoginCommandMock,
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) => selector(appState),
}));

vi.mock("@/renderer/state/agentStatusesStore", () => ({
  useAgentStatusesStore: (
    selector: (state: { agentStatuses: AgentStatus[]; wslAgentStatuses: AgentStatus[] }) => unknown,
  ) => selector(statusesState),
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (state: typeof sharedSettingsState) => unknown) =>
    selector(sharedSettingsState),
}));

vi.mock("@/renderer/components/common", () => ({
  Select: () => <select aria-label="mock-select" />,
}));

import { SingleAgentSettings } from "./SingleAgentSettings";

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

describe("SingleAgentSettings", () => {
  beforeEach(() => {
    statusesState.agentStatuses = [];
    statusesState.wslAgentStatuses = [];
    appState.projects = [];
    sharedSettingsState.disabledAgents = [];
    sharedSettingsState.hiddenModels = {};
    sharedSettingsState.agentSettings = {};
    sharedSettingsState.setAgentDisabled.mockReset();
    sharedSettingsState.setHiddenModels.mockReset();
    sharedSettingsState.setAgentSetting.mockReset();
    runAgentLoginCommandMock.mockReset();
  });

  it("renders identity metadata as a single compact summary line", () => {
    statusesState.agentStatuses = [
      makeStatus("claude", {
        label: "Claude Code",
        version: "2.1.138",
        providerMetadata: {
          authenticatedAs: "user@example.com",
          organization: "Yieldmo",
          plan: "Team Subscription",
          authMethod: "Claude.ai",
        },
      }),
    ];

    render(<SingleAgentSettings agentKind="claude" />);

    expect(screen.getByText("user@example.com · Yieldmo · Team Subscription")).toBeInTheDocument();
    // Auth method is intentionally omitted from the summary when richer
    // identity fields are available.
    expect(screen.queryByText("Auth method")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude.ai")).not.toBeInTheDocument();
  });

  it("summarizes OpenCode connected providers on a single line", () => {
    statusesState.agentStatuses = [
      makeStatus("opencode", {
        label: "OpenCode",
        providerMetadata: {
          connectedProviders: [
            { label: "Copilot", detail: "OAuth" },
            { label: "OpenAI", detail: "OAuth" },
          ],
        },
      }),
    ];

    render(<SingleAgentSettings agentKind="opencode" />);

    expect(screen.getByText("2 providers · Copilot, OpenAI")).toBeInTheDocument();
  });

  it("falls back to the auth method when no identity is available", () => {
    statusesState.agentStatuses = [
      makeStatus("codex", {
        label: "Codex",
        providerMetadata: { authMethod: "ChatGPT" },
      }),
    ];

    render(<SingleAgentSettings agentKind="codex" />);

    expect(screen.getByText("via ChatGPT")).toBeInTheDocument();
  });

  it("shows a login action when the agent reports missing auth", () => {
    statusesState.agentStatuses = [
      makeStatus("gemini", {
        label: "Gemini",
        authState: "missing",
        loginCommand: "gemini auth login",
      }),
    ];

    render(<SingleAgentSettings agentKind="gemini" />);

    expect(screen.getByText("Login required")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    expect(runAgentLoginCommandMock).toHaveBeenCalledWith({
      label: "Gemini",
      command: "gemini auth login",
    });
  });

  it("opens WSL login actions in the matching project distro", () => {
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

    render(<SingleAgentSettings agentKind="codex" />);

    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    expect(runAgentLoginCommandMock).toHaveBeenCalledWith({
      label: "Codex WSL",
      command: "codex login",
      project: wslProject,
    });
  });
});
