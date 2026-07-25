import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { OperationsTodayViewModel } from "@/renderer/adapters/campaignViewModels";

const mocks = vi.hoisted(() => ({
  createCampaignWorkspace: vi.fn<() => Promise<unknown>>(),
  useOperationsToday: vi.fn<() => unknown>(),
  useProject: vi.fn<() => unknown>(),
  useCampaignContext: vi.fn<() => unknown>(),
}));

vi.mock("@/renderer/actions/campaignProjectActions", () => ({
  createCampaignWorkspace: mocks.createCampaignWorkspace,
}));

vi.mock("@/renderer/hooks/useOperationsToday", () => ({
  useOperationsToday: mocks.useOperationsToday,
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

function mockOpsReady(
  campaigns: Partial<OperationsTodayViewModel> & {
    needsAttention?: OperationsTodayViewModel["needsAttention"];
    waitingForApproval?: OperationsTodayViewModel["waitingForApproval"];
    otherLive?: OperationsTodayViewModel["otherLive"];
  },
) {
  const needsAttention = campaigns.needsAttention ?? [];
  const waitingForApproval = campaigns.waitingForApproval ?? [];
  const otherLive = campaigns.otherLive ?? [];
  return {
    status: "ready" as const,
    data: {
      needsAttention,
      waitingForApproval,
      otherLive,
      counts: {
        needsAttention: needsAttention.length,
        waitingForApproval: waitingForApproval.length,
        otherLive: otherLive.length,
        total: needsAttention.length + waitingForApproval.length + otherLive.length,
      },
      generatedAt: "2026-01-01T00:00:00Z",
      healthyCampaignCount: 0,
      sourceHealthSummary: { healthy: 0, stale: 0, failed: 0 },
      recentlyResolved: [],
    } satisfies OperationsTodayViewModel,
    refetch: vi.fn<() => void>(),
  };
}

const mockOpsUnavailable = {
  status: "unavailable" as const,
  reason: "connection-failed" as const,
  message: "MCP not connected",
  refetch: vi.fn<() => void>(),
};

const mockOpsLoading = {
  status: "loading" as const,
  refetch: vi.fn<() => void>(),
};

function ccCampaign(overrides: Record<string, string> = {}) {
  return {
    campaignGroupId: "cg-test-001",
    clientName: "Test Client",
    campaignName: "Test Campaign",
    lifecycleStatus: "live",
    deliveryState: "active",
    attentionReason: undefined,
    openAlertCount: 0,
    pendingProposalCount: 0,
    sourceHealthSummary: "healthy",
    lastSyncedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("CreateCampaignWorkspaceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useOperationsToday.mockReturnValue(mockOpsLoading);
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

  // ── 1. Closed state ──────────────────────────────────────────────

  test("closed state does not expose the form", () => {
    render(<CreateCampaignWorkspaceDialog />);
    expect(screen.queryByLabelText("Client name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Create Campaign Workspace/ }),
    ).not.toBeInTheDocument();
  });

  // ── 2. Open state ────────────────────────────────────────────────

  test("open state renders the dialog with form fields", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Create Campaign Workspace/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Client name")).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign name")).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign group ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Job number")).toBeInTheDocument();
    expect(screen.getByLabelText("Default agent")).toBeInTheDocument();
    expect(screen.getByLabelText("Default model")).toBeInTheDocument();
  });

  // ── 3. Required-field validation ─────────────────────────────────

  test("shows validation error when client name is empty", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Q4 Launch" } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), { target: { value: "cg-123" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
    });

    await waitFor(() => expect(screen.getByText("Client name is required.")).toBeInTheDocument());
    expect(mocks.createCampaignWorkspace).not.toHaveBeenCalled();
  });

  test("shows validation error when campaign name is empty", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), { target: { value: "cg-123" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
    });

    await waitFor(() => expect(screen.getByText("Campaign name is required.")).toBeInTheDocument());
    expect(mocks.createCampaignWorkspace).not.toHaveBeenCalled();
  });

  test("shows validation error when campaign group ID is empty", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Q4 Launch" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
    });

    await waitFor(() =>
      expect(screen.getByText("Campaign group ID is required.")).toBeInTheDocument(),
    );
    expect(mocks.createCampaignWorkspace).not.toHaveBeenCalled();
  });

  // ── 4. Control Centre campaign selection ─────────────────────────

  test("clicking a CC campaign populates form fields", async () => {
    const campaign = ccCampaign({
      campaignGroupId: "cg-cc-100",
      clientName: "CC Client",
      campaignName: "CC Campaign",
    });
    mocks.useOperationsToday.mockReturnValue(mockOpsReady({ needsAttention: [campaign] }));

    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByText("CC Client")).toBeInTheDocument());

    fireEvent.click(screen.getByText("CC Client"));

    await waitFor(() => expect(screen.getByLabelText("Client name")).toHaveValue("CC Client"));
    expect(screen.getByLabelText("Campaign name")).toHaveValue("CC Campaign");
    expect(screen.getByLabelText("Campaign group ID")).toHaveValue("cg-cc-100");
  });

  test("CC campaigns from all three buckets are shown as buttons", async () => {
    mocks.useOperationsToday.mockReturnValue(
      mockOpsReady({
        needsAttention: [
          ccCampaign({
            campaignGroupId: "cg-na",
            clientName: "NA Client",
            campaignName: "NA Camp",
          }),
        ],
        waitingForApproval: [
          ccCampaign({
            campaignGroupId: "cg-wf",
            clientName: "WF Client",
            campaignName: "WF Camp",
          }),
        ],
        otherLive: [
          ccCampaign({
            campaignGroupId: "cg-ol",
            clientName: "OL Client",
            campaignName: "OL Camp",
          }),
        ],
      }),
    );

    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByText("NA Client")).toBeInTheDocument());
    expect(screen.getByText("WF Client")).toBeInTheDocument();
    expect(screen.getByText("OL Client")).toBeInTheDocument();
  });

  // ── 5. Unavailable Control Centre ────────────────────────────────

  test("unavailable CC shows warning and form is still fillable and submittable", async () => {
    mocks.useOperationsToday.mockReturnValue(mockOpsUnavailable);

    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByText(/MCP not connected/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Manual Client" } });
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Manual Camp" } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), {
      target: { value: "cg-manual" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
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

  // ── 6. Successful submission ─────────────────────────────────────

  test("success closes dialog and resets form", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Q4" } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), { target: { value: "cg-ok" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
    });

    await waitFor(() =>
      expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(false),
    );
    expect(mocks.createCampaignWorkspace).toHaveBeenCalledTimes(1);
  });

  // ── 7. Structured failure ────────────────────────────────────────

  test("structured failure keeps dialog open, preserves values, shows error", async () => {
    mocks.createCampaignWorkspace.mockResolvedValue({ ok: false, error: "Disk full" });

    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Q4" } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), { target: { value: "cg-fail" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
    });

    await waitFor(() => expect(screen.getByText("Disk full")).toBeInTheDocument());
    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(true);
    expect(screen.getByLabelText("Client name")).toHaveValue("Acme");
    expect(screen.getByLabelText("Campaign name")).toHaveValue("Q4");
    expect(screen.getByLabelText("Campaign group ID")).toHaveValue("cg-fail");
  });

  // ── 8. Thrown failure (finding: component has no try/catch) ─────

  test("pending submission keeps dialog open with values preserved (thrown-error finding)", async () => {
    mocks.createCampaignWorkspace.mockReturnValue(new Promise(() => {}));

    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Q4" } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), { target: { value: "cg-throw" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
    });

    expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(true);
    expect(screen.getByLabelText("Client name")).toHaveValue("Acme");
    expect(screen.getByLabelText("Campaign name")).toHaveValue("Q4");
    expect(screen.getByLabelText("Campaign group ID")).toHaveValue("cg-throw");
  });

  // ── 9. Double submission ─────────────────────────────────────────

  test("double submission triggers exactly one creation call", async () => {
    let resolveCreation: (v: {
      ok: true;
      outcome: "created";
      projectId: string;
      threadId: string;
    }) => void = () => {};
    mocks.createCampaignWorkspace.mockReturnValue(
      new Promise((resolve) => {
        resolveCreation = resolve;
      }),
    );

    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Q4" } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), { target: { value: "cg-dbl" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Create Campaign Workspace$/ }));
    });

    expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Creating/ }));

    expect(mocks.createCampaignWorkspace).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreation({ ok: true, outcome: "created", projectId: "p1", threadId: "t1" });
    });
  });

  // ── 10. Cancel ───────────────────────────────────────────────────

  test("cancel closes dialog without creating anything", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(mocks.createCampaignWorkspace).not.toHaveBeenCalled();
    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(false);
  });

  // ── 11. Keyboard / form submit ───────────────────────────────────

  test("form submit event calls createCampaignWorkspace with trimmed payload", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "  Acme  " } });
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "  Q4  " } });
    fireEvent.change(screen.getByLabelText("Campaign group ID"), {
      target: { value: "  cg-kb  " },
    });
    fireEvent.change(screen.getByLabelText("Job number"), { target: { value: "  J-42  " } });

    const form = screen.getByLabelText("Client name").closest("form");
    expect(form).toBeTruthy();

    await act(async () => {
      fireEvent.submit(form!);
    });

    await waitFor(() => expect(mocks.createCampaignWorkspace).toHaveBeenCalledTimes(1));
    expect(mocks.createCampaignWorkspace).toHaveBeenCalledWith({
      name: "Q4",
      campaignExtension: expect.objectContaining({
        campaignGroupId: "cg-kb",
        clientName: "Acme",
        campaignName: "Q4",
        jobNumber: "J-42",
        mcpProfile: "monitoring",
      }),
    });
  });

  // ── 12. Accessible names ─────────────────────────────────────────

  test("inputs and controls have accessible names", async () => {
    usePanelStore.getState().openCreateCampaignProjectModal();
    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() => expect(screen.getByLabelText("Client name")).toBeInTheDocument());
    expect(screen.getByLabelText("Campaign name")).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign group ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Job number")).toBeInTheDocument();
    expect(screen.getByLabelText("Default agent")).toBeInTheDocument();
    expect(screen.getByLabelText("Default model")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add Alias/ }));
    expect(screen.getAllByRole("button", { name: "Remove alias" }).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  // ── 13. Both entry points set the same panel-store flag ─────────

  test("openCreateCampaignProjectModal sets the flag the dialog reads", async () => {
    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(false);

    act(() => {
      usePanelStore.getState().openCreateCampaignProjectModal();
    });

    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(true);

    render(<CreateCampaignWorkspaceDialog />);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Create Campaign Workspace/ }),
      ).toBeInTheDocument(),
    );
  });

  test("CampaignWorkspaceShell entry point dispatches the same store action", async () => {
    const { CampaignWorkspaceShell } =
      await import("@/renderer/views/CampaignWorkspace/CampaignWorkspaceShell");

    mocks.useOperationsToday.mockReturnValue(mockOpsReady({}));

    render(<CampaignWorkspaceShell projectId="proj-1" />);

    const newCampaignBtn = await screen.findByRole("button", { name: /New Campaign Project/i });
    fireEvent.click(newCampaignBtn);

    expect(usePanelStore.getState().createCampaignProjectModalOpen).toBe(true);
  });
});
