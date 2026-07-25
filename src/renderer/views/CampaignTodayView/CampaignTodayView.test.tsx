import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolCallPayload, McpToolCallResult, Project } from "@/shared/contracts";
import { controlCentreOperationsTodayFixture } from "@/shared/contracts/campaign/fixtures/controlCentreOperationsToday.fixture";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { CampaignTodayView } from "./CampaignTodayView";

const mocks = vi.hoisted(() => ({
  callMcpTool: vi.fn<(payload: McpToolCallPayload) => Promise<McpToolCallResult>>(),
  ensureCampaignsHubProject: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/renderer/campaign/ensureCampaignsHubProject", () => ({
  ensureCampaignsHubProject: mocks.ensureCampaignsHubProject,
  CAMPAIGNS_HUB_GROUP_ID: "poracode-campaigns-hub",
}));

vi.mock("@/renderer/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/bridge")>();
  return {
    ...actual,
    isRemoteSession: () => false,
    readBridge: () => ({
      callMcpTool: mocks.callMcpTool,
      getProfileIdentity: async () => ({
        identity: { name: "", handle: "", avatarColor: "#8B7BFF" },
        device: { id: "test", label: "Test", platform: "darwin" },
      }),
    }),
  };
});

const controlCentreServer = {
  id: "cc-1",
  name: "Control-Centre",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "http" as const, url: "https://cc.example.com/mcp", headers: {} },
};

function campaignProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Campaign Workspace",
    location: { kind: "posix", path: "/repo" },
    createdAt: "2026-07-01T00:00:00.000Z",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      clientName: "Bright Horizon Group",
      campaignName: "Q4 Brand Refresh",
    },
    mcpServers: [controlCentreServer],
    ...overrides,
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

describe("CampaignTodayView", () => {
  beforeEach(() => {
    mocks.callMcpTool.mockReset();
    mocks.ensureCampaignsHubProject.mockReset();
    useAppStore.setState((state) => ({
      ...state,
      projects: [campaignProject()],
      view: { kind: "campaignToday" },
    }));
    useSharedSettings.setState({ mcpServers: [] });
    mocks.callMcpTool.mockResolvedValue(toolResult(controlCentreOperationsTodayFixture));
    mocks.ensureCampaignsHubProject.mockResolvedValue({
      ok: true,
      projectId: "hub-project",
      threadId: "hub-thread",
    });
  });

  it("renders operations today buckets from the fixture payload", async () => {
    render(<CampaignTodayView />);

    await waitFor(() => {
      expect(screen.getByText(/Needs attention/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Q4 Brand Refresh/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Holiday Gifting Campaign/)).toBeInTheDocument();
    expect(screen.getAllByText(/B2B Lead Gen/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Recently resolved/i)).toBeInTheDocument();
    expect(screen.getByText(/Source health/i)).toBeInTheDocument();
  });

  it("shows the setup card for pinning workspaces while ask-anything stays enabled", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [],
      view: { kind: "campaignToday" },
    }));
    useSharedSettings.setState({ mcpServers: [controlCentreServer] });

    render(<CampaignTodayView />);

    expect(
      screen.getByText(/Ask questions above anytime Control Centre is connected/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Ask anything about your campaigns")).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Pin campaign workspace/i }));
    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(true);
  });

  it("routes zero-project ask-anything through the auto-created campaigns hub", async () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [],
      view: { kind: "campaignToday" },
    }));
    useSharedSettings.setState({ mcpServers: [controlCentreServer] });

    render(<CampaignTodayView />);

    await waitFor(() => {
      expect(screen.getByText(/Needs attention/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Ask anything about your campaigns"), {
      target: { value: "Which campaigns need me today?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(mocks.ensureCampaignsHubProject).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().view).toEqual({ kind: "draft", projectId: "hub-project" });
    expect(useAppStore.getState().pendingCampaignComposerPrefill).toEqual({
      projectId: "hub-project",
      text: "Which campaigns need me today?",
    });
  });

  it("shows the no-campaign-projects setup state with a create action", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [],
      view: { kind: "campaignToday" },
    }));

    render(<CampaignTodayView />);

    expect(
      screen.getByText(/Ask questions above anytime Control Centre is connected/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Ask anything about your campaigns")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Pin campaign workspace/i }));
    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(true);
  });

  it("shows a distinct Control Centre setup state when campaign projects exist without a connection", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [
        campaignProject({
          mcpServers: [],
        }),
      ],
      view: { kind: "campaignToday" },
    }));

    render(<CampaignTodayView />);

    expect(screen.getByText(/Control Centre is not connected/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Ask questions above anytime Control Centre is connected/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Pin campaign workspace/i }),
    ).not.toBeInTheDocument();
  });
});
