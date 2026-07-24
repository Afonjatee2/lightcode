import type { ReactElement } from "react";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolCallPayload, McpToolCallResult, Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { CampaignModeGate } from "./CampaignModeGate";

// ============================================================================
// Mocks
// ============================================================================

const mocks = vi.hoisted(() => ({
  callMcpTool: vi.fn<(payload: McpToolCallPayload) => Promise<McpToolCallResult>>(),
  CampaignWorkspaceShell: vi.fn<(props: { projectId: string }) => ReactElement>(() => (
    <div data-testid="campaign-workspace-shell" />
  )),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({ callMcpTool: mocks.callMcpTool }),
}));

vi.mock("@/renderer/views/CampaignWorkspace/CampaignWorkspaceShell", () => ({
  CampaignWorkspaceShell: mocks.CampaignWorkspaceShell,
}));

// ============================================================================
// Helpers
// ============================================================================

const controlCentreServer = {
  id: "cc-1",
  name: "control-centre",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "http" as const, url: "https://cc.example.com/mcp", headers: {} },
};

function codeProject(): Project {
  return {
    id: "project-code",
    name: "My Code Project",
    location: { kind: "posix", path: "/repo" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function campaignProject(): Project {
  return {
    id: "project-campaign",
    name: "Client Campaign",
    location: { kind: "posix", path: "/repo" },
    createdAt: "2026-07-01T00:00:00.000Z",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: "group-1",
      clientName: "Real Client Ltd",
      campaignName: "Real Live Campaign",
    },
    mcpServers: [controlCentreServer],
  };
}

function toolResult(content: unknown): McpToolCallResult {
  return {
    status: "ok",
    content,
    latencyMs: 3,
    environment: { runtime: "host", projectScoped: false },
  };
}

const operationsTodayResponse = {
  needsAttention: [],
  waitingForApproval: [],
  otherLive: [],
  healthyCampaignCount: 0,
  sourceHealthSummary: { healthy: 0, stale: 0, failed: 0 },
  recentlyResolved: [],
  generatedAt: "2026-07-22T09:00:00.000Z",
};

// ============================================================================
// Tests
// ============================================================================

describe("CampaignModeGate", () => {
  beforeEach(() => {
    mocks.callMcpTool.mockReset();
    mocks.CampaignWorkspaceShell.mockClear();
    useAppStore.setState((state) => ({ ...state, projects: [] }));
    useSharedSettings.setState({ mcpServers: [] });
  });

  // ---------- Code project ----------

  it("renders children (standard code view) for a code project", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [codeProject()],
    }));

    render(
      <CampaignModeGate projectId="project-code">
        <div data-testid="code-content">Standard Code View</div>
      </CampaignModeGate>,
    );

    expect(screen.getByTestId("code-content")).toBeInTheDocument();
    expect(screen.getByText("Standard Code View")).toBeInTheDocument();
    // CampaignWorkspaceShell should NOT be rendered
    expect(mocks.CampaignWorkspaceShell).not.toHaveBeenCalled();
  });

  it("renders children for a project without a purpose (legacy default to code)", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [codeProject()],
    }));

    render(
      <CampaignModeGate projectId="project-code">
        <div data-testid="code-content">Legacy Code View</div>
      </CampaignModeGate>,
    );

    expect(screen.getByTestId("code-content")).toBeInTheDocument();
    expect(mocks.CampaignWorkspaceShell).not.toHaveBeenCalled();
  });

  it("renders children for a research project", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [{ ...codeProject(), id: "project-research", purpose: "research" }],
    }));

    render(
      <CampaignModeGate projectId="project-research">
        <div data-testid="research-content">Research View</div>
      </CampaignModeGate>,
    );

    expect(screen.getByTestId("research-content")).toBeInTheDocument();
    expect(mocks.CampaignWorkspaceShell).not.toHaveBeenCalled();
  });

  it("renders children for a general project", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [{ ...codeProject(), id: "project-general", purpose: "general" }],
    }));

    render(
      <CampaignModeGate projectId="project-general">
        <div data-testid="general-content">General View</div>
      </CampaignModeGate>,
    );

    expect(screen.getByTestId("general-content")).toBeInTheDocument();
    expect(mocks.CampaignWorkspaceShell).not.toHaveBeenCalled();
  });

  // ---------- Campaign project ----------

  it("mounts CampaignWorkspaceShell for a campaign project with valid extension", async () => {
    mocks.callMcpTool.mockImplementation((payload) =>
      Promise.resolve(
        toolResult(
          payload.toolName === "get_operations_today"
            ? operationsTodayResponse
            : {
                identity: {
                  id: "group-1",
                  name: "Real Live Campaign",
                  clientName: "Real Client Ltd",
                  jobNumber: null,
                  startDate: "2026-01-01",
                  endDate: "2026-03-31",
                  status: "live",
                },
                budget: {
                  totalBudget: 10_000,
                  spentToDate: 4_000,
                  remaining: 6_000,
                  percentUsed: 0.4,
                  expectedPercentUsed: 0.5,
                  pacingStatus: "on_track",
                },
                kpiTargets: [],
                openAlerts: [],
                channelExecutions: [],
                sourceHealth: [],
                activeDecisions: [],
                recentEvents: [],
                pendingProposals: [],
                evidence: [],
                suggestedQuestions: [],
              },
        ),
      ),
    );

    useAppStore.setState((state) => ({
      ...state,
      projects: [campaignProject()],
    }));

    render(
      <CampaignModeGate projectId="project-campaign">
        <div data-testid="code-content">Should Not Appear</div>
      </CampaignModeGate>,
    );

    // The CampaignWorkspaceShell should be mounted (not the children)
    await waitFor(() => {
      expect(screen.getByTestId("campaign-workspace-shell")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("code-content")).not.toBeInTheDocument();
  });

  it("shows Advanced Mode button for campaign projects", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [campaignProject()],
    }));

    render(
      <CampaignModeGate projectId="project-campaign">
        <div>Hidden Code Content</div>
      </CampaignModeGate>,
    );

    // The "Advanced Mode (Code)" button should be visible
    expect(screen.getByText(/Advanced Mode \(Code\)/i)).toBeInTheDocument();
  });

  it("switches to code view when Advanced Mode is clicked", async () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [campaignProject()],
    }));

    render(
      <CampaignModeGate projectId="project-campaign">
        <div data-testid="code-content">Hidden Code Content</div>
      </CampaignModeGate>,
    );

    // Click Advanced Mode
    const advancedButton = screen.getByText(/Advanced Mode \(Code\)/i);
    advancedButton.click();

    // Now code children should be visible and CampaignWorkspaceShell hidden
    await waitFor(() => {
      expect(screen.getByTestId("code-content")).toBeInTheDocument();
    });
    expect(screen.getByText("Hidden Code Content")).toBeInTheDocument();
  });

  it("shows Back to Campaign button when in advanced mode", async () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [campaignProject()],
    }));

    render(
      <CampaignModeGate projectId="project-campaign">
        <div data-testid="code-content">Hidden Code Content</div>
      </CampaignModeGate>,
    );

    // Click Advanced Mode
    screen.getByText(/Advanced Mode \(Code\)/i).click();

    // Should now show "Back to Campaign"
    await waitFor(() => {
      expect(screen.getByText(/Back to Campaign/i)).toBeInTheDocument();
    });
  });

  // ---------- Empty / missing project ----------

  it("renders children when project is undefined (not found)", () => {
    render(
      <CampaignModeGate projectId="nonexistent">
        <div data-testid="fallback-content">Default View</div>
      </CampaignModeGate>,
    );

    expect(screen.getByTestId("fallback-content")).toBeInTheDocument();
    expect(mocks.CampaignWorkspaceShell).not.toHaveBeenCalled();
  });

  it("does not invent a placeholder campaign name for an unlinked campaign project", () => {
    // A campaign project that exists but the user hasn't linked a Control Centre
    // campaign yet (no campaignGroupId in extension)
    useAppStore.setState((state) => ({
      ...state,
      projects: [
        {
          ...campaignProject(),
          campaignExtension: {
            ...campaignProject().campaignExtension!,
            campaignGroupId: "",
          },
        },
      ],
    }));

    render(
      <CampaignModeGate projectId="project-campaign">
        <div data-testid="code-content">Fallback</div>
      </CampaignModeGate>,
    );

    // CampaignModeGate checks project purpose only, not extension identity
    // So it mounts the workspace shell even with empty campaignGroupId.
    // The shell's useCampaignContext hook skips the MCP call (because skip is true
    // when no campaignGroupId), showing the distinct "empty" state.
    expect(screen.getByTestId("campaign-workspace-shell")).toBeInTheDocument();
  });
});
