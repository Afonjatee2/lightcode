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
    useAppStore.setState((state) => ({
      ...state,
      projects: [campaignProject()],
      view: { kind: "campaignToday" },
    }));
    useSharedSettings.setState({ mcpServers: [] });
    mocks.callMcpTool.mockResolvedValue(toolResult(controlCentreOperationsTodayFixture));
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

  it("shows the no-campaign-projects setup state with a create action", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [],
      view: { kind: "campaignToday" },
    }));

    render(<CampaignTodayView />);

    expect(
      screen.getByText(/links Poracode to your Control Centre campaigns/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Add Control Centre MCP/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /New Campaign Project/i }));
    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(true);
  });

  it("shows a distinct Control Centre setup state when campaign projects exist without MCP", () => {
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

    expect(
      screen.getByText(/No MCP server named "control-centre" is configured/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/links Poracode to your Control Centre campaigns/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Campaign Project/i })).not.toBeInTheDocument();
  });
});
