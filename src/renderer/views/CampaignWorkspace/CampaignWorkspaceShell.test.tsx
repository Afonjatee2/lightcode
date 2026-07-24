import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolCallPayload, McpToolCallResult, Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { CampaignWorkspaceShell } from "./CampaignWorkspaceShell";

const mocks = vi.hoisted(() => ({
  callMcpTool: vi.fn<(payload: McpToolCallPayload) => Promise<McpToolCallResult>>(),
}));

vi.mock("@/renderer/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/bridge")>();
  return {
    ...actual,
    isRemoteSession: () => false,
    readBridge: () => ({
      callMcpTool: mocks.callMcpTool,
    }),
  };
});

const controlCentreServer = {
  id: "cc-1",
  name: "control-centre",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "http" as const, url: "https://cc.example.com/mcp", headers: {} },
};

function campaignProject(): Project {
  return {
    id: "project-1",
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

/** Placeholder strings the old `PLACEHOLDER_CAMPAIGNS` scaffolding rendered. */
const PLACEHOLDER_STRINGS = ["Acme Corp", "Globex", "Initech", "Umbrella"];

function toolResult(content: unknown): McpToolCallResult {
  return {
    status: "ok",
    content,
    latencyMs: 3,
    environment: { runtime: "host", projectScoped: false },
  };
}

const operationsTodayResponse = {
  needsAttention: [
    {
      campaignGroupId: "group-2",
      name: "Other Campaign",
      clientName: "Other Client",
      status: "live",
      deliveryState: "stale",
      openAlerts: 3,
      pendingProposals: 1,
      sourceHealthSummary: { healthy: 0, stale: 1, failed: 0 },
      lastDataFreshnessAt: null,
      topPriority: "P1",
      attentionReason: "3 open alerts, highest priority P1",
    },
  ],
  waitingForApproval: [],
  otherLive: [],
  healthyCampaignCount: 0,
  sourceHealthSummary: { healthy: 0, stale: 1, failed: 0 },
  recentlyResolved: [],
  generatedAt: "2026-07-22T09:00:00.000Z",
};

const campaignContextResponse = {
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
};

describe("CampaignWorkspaceShell", () => {
  beforeEach(() => {
    mocks.callMcpTool.mockReset();
    useAppStore.setState((state) => ({ ...state, projects: [campaignProject()] }));
    useSharedSettings.setState({ mcpServers: [] });
  });

  it("never renders the old PLACEHOLDER_CAMPAIGNS fake clients", async () => {
    mocks.callMcpTool.mockImplementation((payload) =>
      Promise.resolve(
        toolResult(
          payload.toolName === "get_operations_today"
            ? operationsTodayResponse
            : campaignContextResponse,
        ),
      ),
    );

    render(<CampaignWorkspaceShell projectId="project-1" />);

    await waitFor(() => expect(screen.getByText("Real Client Ltd")).toBeInTheDocument());

    for (const placeholder of PLACEHOLDER_STRINGS) {
      expect(screen.queryByText(placeholder)).not.toBeInTheDocument();
    }
  });

  it("renders real campaign identity and nav-pane data from the live MCP responses", async () => {
    mocks.callMcpTool.mockImplementation((payload) =>
      Promise.resolve(
        toolResult(
          payload.toolName === "get_operations_today"
            ? operationsTodayResponse
            : campaignContextResponse,
        ),
      ),
    );

    render(<CampaignWorkspaceShell projectId="project-1" />);

    await waitFor(() => expect(screen.getByText("Real Client Ltd")).toBeInTheDocument());
    expect(screen.getByText("Real Live Campaign")).toBeInTheDocument();
    // Nav pane lists the *other* live campaign group from get_operations_today.
    expect(screen.getByText("Other Client")).toBeInTheDocument();
  });

  it("shows a loading state before either MCP call resolves", () => {
    mocks.callMcpTool.mockImplementation(() => new Promise(() => {}));

    render(<CampaignWorkspaceShell projectId="project-1" />);

    expect(screen.getByText(/Loading campaign context/i)).toBeInTheDocument();
  });

  it("shows a distinct empty state when the project has no bound campaign group and no selection", async () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [{ ...campaignProject(), campaignExtension: undefined, purpose: "code" }],
    }));
    mocks.callMcpTool.mockResolvedValue(toolResult(operationsTodayResponse));

    render(<CampaignWorkspaceShell projectId="project-1" />);

    await waitFor(() =>
      expect(
        screen.getByText(/isn't linked to a Control Centre campaign yet/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows a distinct error state when Control Centre returns an unavailable result", async () => {
    mocks.callMcpTool.mockImplementation((payload) =>
      Promise.resolve(
        payload.toolName === "get_operations_today"
          ? toolResult(operationsTodayResponse)
          : ({
              status: "unavailable",
              latencyMs: 1,
              environment: { runtime: "host", projectScoped: false },
              error: { code: "connection-failed", message: "Could not connect to the MCP server." },
            } satisfies McpToolCallResult),
      ),
    );

    render(<CampaignWorkspaceShell projectId="project-1" />);

    await waitFor(() =>
      expect(screen.getByText("Could not connect to the MCP server.")).toBeInTheDocument(),
    );
  });
});
