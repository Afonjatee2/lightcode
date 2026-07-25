import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { controlCentreCampaignGroupListFixture } from "@/shared/contracts/campaign/fixtures/controlCentreCampaignGroupList.fixture";

const mocks = vi.hoisted(() => ({
  createCampaignWorkspace: vi.fn<() => Promise<unknown>>(),
  useCampaignGroupList: vi.fn<() => unknown>(),
  useProject: vi.fn<() => unknown>(),
  useCampaignContext: vi.fn<() => unknown>(),
}));

vi.mock("@/renderer/actions/campaignProjectActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/actions/campaignProjectActions")>();
  return {
    ...actual,
    createCampaignWorkspace: mocks.createCampaignWorkspace,
  };
});

vi.mock("@/renderer/hooks/useCampaignGroupList", () => ({
  useCampaignGroupList: mocks.useCampaignGroupList,
}));

vi.mock("@/renderer/state/useThread", () => ({
  useProject: () => mocks.useProject(),
}));

vi.mock("@/renderer/hooks/useCampaignContext", () => ({
  useCampaignContext: () => mocks.useCampaignContext(),
}));

import { usePanelStore } from "@/renderer/state/panelStore";
import { useAppStore } from "@/renderer/state/appStore";
import { CreateCampaignWorkspaceDialog } from "./CreateCampaignWorkspaceDialog";

const mockGroupsLoading = {
  status: "loading" as const,
  refetch: vi.fn<() => void>(),
};

const mockGroupsUnavailable = {
  status: "unavailable" as const,
  reason: "connection-failed" as const,
  message: "Could not reach Control Centre",
  refetch: vi.fn<() => void>(),
};

function mockGroupsReady() {
  return {
    status: "ready" as const,
    data: controlCentreCampaignGroupListFixture,
    refetch: vi.fn<() => void>(),
  };
}

describe("CreateCampaignWorkspaceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useCampaignGroupList.mockReturnValue(mockGroupsLoading);
    mocks.createCampaignWorkspace.mockResolvedValue({
      ok: true,
      outcome: "created",
      projectId: "p1",
      threadId: "t1",
    });
    mocks.useProject.mockReturnValue({
      id: "proj-1",
      name: "Test Campaign",
      purpose: "campaign" as const,
      campaignExtension: { campaignGroupId: "cg-shell-1" },
      location: { kind: "posix" as const, path: "/tmp/test" },
      createdAt: "2026-01-01T00:00:00Z",
    });
    mocks.useCampaignContext.mockReturnValue({ status: "loading" as const });
    useAppStore.setState({ projects: [] });
    usePanelStore.setState({ createCampaignProjectModalOpen: false });
  });

  afterEach(() => {
    cleanup();
    usePanelStore.setState({ createCampaignProjectModalOpen: false });
  });

  test("closed state does not expose the picker", () => {
    render(<CreateCampaignWorkspaceDialog />);
    expect(
      screen.queryByRole("heading", { name: /Add campaign workspace/i }),
    ).not.toBeInTheDocument();
  });

  test("renders groups from the fixture and filters by job number", async () => {
    mocks.useCampaignGroupList.mockReturnValue(mockGroupsReady());
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByText("Q4 Brand Refresh")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Search campaigns"), { target: { value: "A55201" } });
    expect(screen.getByText("Q4 Brand Refresh")).toBeInTheDocument();
    expect(screen.queryByText("Holiday Gifting Campaign")).not.toBeInTheDocument();
  });

  test("selection derives all campaign extension fields from the group record", async () => {
    mocks.useCampaignGroupList.mockReturnValue(mockGroupsReady());
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByText("Q4 Brand Refresh")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Q4 Brand Refresh"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Add workspace$/ }));
    });

    await waitFor(() => expect(mocks.createCampaignWorkspace).toHaveBeenCalledTimes(1));
    expect(mocks.createCampaignWorkspace).toHaveBeenCalledWith({
      name: "Q4 Brand Refresh",
      campaignExtension: {
        campaignGroupId: "cg-live-001",
        clientName: "Bright Horizon Group",
        campaignName: "Q4 Brand Refresh",
        jobNumber: "A55201",
        mcpProfile: "plan_revision",
      },
    });
  });

  test("unavailable Control Centre opens Advanced and still allows manual creation", async () => {
    mocks.useCampaignGroupList.mockReturnValue(mockGroupsUnavailable);
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() =>
      expect(screen.getByText(/Could not reach Control Centre/)).toBeInTheDocument(),
    );
    expect(screen.getAllByLabelText("Workspace name").length).toBeGreaterThan(0);

    fireEvent.change(screen.getAllByLabelText("Workspace name")[1]!, {
      target: { value: "Manual Camp" },
    });
    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Manual Client" } });
    fireEvent.change(screen.getByLabelText("Campaign reference"), {
      target: { value: "cg-manual" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create manually$/ }));
    });

    await waitFor(() => expect(mocks.createCampaignWorkspace).toHaveBeenCalledTimes(1));
    expect(mocks.createCampaignWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Manual Camp",
        campaignExtension: expect.objectContaining({
          clientName: "Manual Client",
          campaignName: "Manual Camp",
          campaignGroupId: "cg-manual",
        }),
      }),
    );
  });

  test("shows a loading state while groups are fetched", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);
    expect(screen.getByText(/Loading campaigns from Control Centre/)).toBeInTheDocument();
  });

  test("creates an unlinked workspace from the name-only path", async () => {
    mocks.useCampaignGroupList.mockReturnValue(mockGroupsReady());
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    fireEvent.change(screen.getByTestId("unlinked-workspace-name"), {
      target: { value: "AIB GAA A55201" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Start without linking$/ }));
    });

    await waitFor(() => expect(mocks.createCampaignWorkspace).toHaveBeenCalledTimes(1));
    expect(mocks.createCampaignWorkspace).toHaveBeenCalledWith({
      name: "AIB GAA A55201",
      campaignExtension: {
        campaignGroupId: "",
        clientName: "AIB GAA A55201",
        campaignName: "AIB GAA A55201",
      },
    });
  });
});
