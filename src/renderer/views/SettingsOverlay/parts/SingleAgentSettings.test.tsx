import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";

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

vi.mock("@heroui/react", () => {
  function Button(props: { children?: ReactNode }) {
    return <button type="button">{props.children}</button>;
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

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: (selector: (state: { projects: [] }) => unknown) => selector({ projects: [] }),
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

describe("SingleAgentSettings", () => {
  beforeEach(() => {
    statusesState.agentStatuses = [];
    statusesState.wslAgentStatuses = [];
    sharedSettingsState.disabledAgents = [];
    sharedSettingsState.hiddenModels = {};
    sharedSettingsState.agentSettings = {};
    sharedSettingsState.setAgentDisabled.mockReset();
    sharedSettingsState.setHiddenModels.mockReset();
    sharedSettingsState.setAgentSetting.mockReset();
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
});
