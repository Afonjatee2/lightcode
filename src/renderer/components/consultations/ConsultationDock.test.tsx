import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { SupervisorEvent } from "@/shared/ipc/events";
import type {
  ConsultationRecord,
  ConsultationResultRecord,
  ContextPacketRecord,
  PanelMembershipRecord,
} from "@/shared/consultations";
import { useConsultationStore } from "./consultationStore";
import { ConsultationDock } from "./ConsultationDock";

interface ListResult {
  consultations: ConsultationRecord[];
  results: ConsultationResultRecord[];
  panelMembers: PanelMembershipRecord[];
  contextPackets: import("@/shared/consultations").ContextPacketRecord[];
}

const consultationListForThread = vi.fn<(payload: { parentThreadId: string }) => Promise<ListResult>>();
const consultationCancel = vi.fn<
  (payload: { id: string }) => Promise<{ consultation: ConsultationRecord | null }>
>();
const consultationRetry = vi.fn<
  (payload: { id: string }) => Promise<{ consultation: ConsultationRecord | null }>
>();
const consultationGet = vi.fn<
  (payload: { id: string }) => Promise<{
    consultation: ConsultationRecord | null;
    result: ConsultationResultRecord | null;
    contextPacket: ContextPacketRecord | null;
  }>
>();
let eventListener: ((event: SupervisorEvent) => void) | null = null;
const onSupervisorEvent = vi.fn<(listener: (event: SupervisorEvent) => void) => () => void>(
  (listener) => {
    eventListener = listener;
    return () => {
      eventListener = null;
    };
  },
);

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    consultationListForThread,
    consultationCancel,
    consultationRetry,
    consultationGet,
    onSupervisorEvent,
  }),
}));

function makeRecord(overrides: Partial<ConsultationRecord> = {}): ConsultationRecord {
  return {
    id: "c-1",
    parentProjectId: "p-1",
    parentThreadId: "t-1",
    campaignGroupId: "cg-1",
    childThreadOrRunId: "child-1",
    originalMention: "@codex verify these figures",
    originalInstruction: "verify these figures",
    resolvedRole: "daily_operator",
    requestedProvider: "codex",
    actualProvider: "codex",
    requestedModel: null,
    actualModel: "gpt-5",
    consultationMode: "standard",
    status: "running",
    contextPacketId: null,
    permissionPolicyVersion: "v1",
    actor: "user",
    createdAt: "2026-07-21T10:00:00.000Z",
    startedAt: "2026-07-21T10:00:01.000Z",
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    safeFailureMessage: null,
    resultSummaryId: null,
    retryOfConsultationId: null,
    ...overrides,
  };
}

function makeContextPacket(overrides: Partial<ContextPacketRecord> = {}): ContextPacketRecord {
  return {
    id: "packet-1",
    consultationId: "c-1",
    structuredContext: {
      parentRequest: "@codex verify these figures",
      explicitTask: "verify these figures",
      relevantRecentConversation: [],
      durableThreadSummary: null,
      campaignIdentity: {
        campaignGroupId: "cg-1",
        campaignName: "Community Fund",
        clientName: "AIB NI",
        status: "active",
      },
      dates: { startDate: "2026-07-01", endDate: "2026-09-30" },
      budget: {
        totalBudget: null,
        spentToDate: 100,
        remaining: null,
        percentUsed: null,
        expectedPercentUsed: null,
        pacingStatus: null,
      },
      kpiEvidence: [],
      alerts: [],
      activeDecisions: [],
      pendingProposals: [],
      recentCampaignEvents: [],
      permittedAttachments: [],
      evidenceFreshness: {
        oldestCapturedAt: "2026-07-20T00:00:00.000Z",
        newestCapturedAt: "2026-07-21T00:00:00.000Z",
        staleSourceCount: 1,
        statuses: [{ label: "Google Ads", freshnessStatus: "stale" }],
      },
      missingDataWarnings: ["Google Ads source is stale"],
      permissionConstraints: [],
      redactionMetadata: {
        redactedCount: 0,
        redactedFields: [],
        appliedAt: "2026-07-21T00:00:00.000Z",
      },
      createdAt: "2026-07-21T00:00:00.000Z",
      contractVersion: "consultation-context-v1",
      contentHash: "hash-1",
    },
    contentHash: "hash-1",
    contractVersion: "consultation-context-v1",
    redactionMetadata: {
      redactedCount: 0,
      redactedFields: [],
      appliedAt: "2026-07-21T00:00:00.000Z",
    },
    evidenceFreshness: {
      oldestCapturedAt: "2026-07-20T00:00:00.000Z",
      newestCapturedAt: "2026-07-21T00:00:00.000Z",
      staleSourceCount: 1,
      statuses: [{ label: "Google Ads", freshnessStatus: "stale" }],
    },
    missingDataWarnings: ["Google Ads source is stale"],
    createdAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function makeResult(): ConsultationResultRecord {
  return {
    id: "result-1",
    consultationId: "c-1",
    summary: "Figures verified; spend is ahead of plan.",
    keyFindings: ["Pacing ahead of plan"],
    evidenceReferences: [],
    assumptions: [],
    uncertainties: [],
    recommendedActions: ["Rebalance toward Google"],
    suggestedProposalInputs: [],
    generatedFileReferences: [],
    completedAt: "2026-07-21T10:05:00.000Z",
  };
}

describe("ConsultationDock — mounted campaign-thread surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventListener = null;
    useConsultationStore.getState().clear();
    consultationListForThread.mockResolvedValue({
      consultations: [makeRecord()],
      results: [],
      panelMembers: [],
      contextPackets: [],
    });
    consultationCancel.mockImplementation(async ({ id }: { id: string }) => ({
      consultation: makeRecord({ id, status: "cancelled", cancelledAt: "2026-07-21T10:06:00.000Z" }),
    }));
    consultationRetry.mockImplementation(async ({ id }: { id: string }) => ({
      consultation: makeRecord({ id: "c-retry", status: "queued", retryOfConsultationId: id }),
    }));
    consultationGet.mockResolvedValue({
      consultation: makeRecord({ contextPacketId: "packet-1" }),
      result: null,
      contextPacket: makeContextPacket(),
    });
  });

  it("loads the thread's consultations on mount and renders the card", async () => {
    render(<ConsultationDock threadId="t-1" />);
    expect(await screen.findByText("verify these figures")).toBeTruthy();
    expect(consultationListForThread).toHaveBeenCalledWith({ parentThreadId: "t-1" });
    expect(onSupervisorEvent).toHaveBeenCalledTimes(1);
  });

  it("routes cancel through the consultation IPC", async () => {
    render(<ConsultationDock threadId="t-1" />);
    const cancel = await screen.findByRole("button", { name: /cancel/i });
    fireEvent.click(cancel);
    await waitFor(() => expect(consultationCancel).toHaveBeenCalledWith({ id: "c-1" }));
    // The cancelled record fed back into the store updates the card.
    expect(await screen.findByText("Consultation was cancelled")).toBeTruthy();
  });

  it("updates the card live when a consultation-updated event arrives", async () => {
    render(<ConsultationDock threadId="t-1" />);
    await screen.findByText("verify these figures");
    expect(eventListener).toBeTruthy();

    await act(async () => {
      eventListener?.({
        type: "consultation-updated",
        record: makeRecord({ status: "completed", completedAt: "2026-07-21T10:05:00.000Z", resultSummaryId: "result-1" }),
        result: makeResult(),
      });
    });

    expect(await screen.findByText("Figures verified; spend is ahead of plan.")).toBeTruthy();
    expect(await screen.findByText(/consultation complete/i)).toBeTruthy();
  });

  it("loads a newly referenced context packet once and updates warnings live", async () => {
    render(<ConsultationDock threadId="t-1" />);
    await screen.findByText("verify these figures");

    const updated = makeRecord({ contextPacketId: "packet-1" });
    await act(async () => {
      eventListener?.({ type: "consultation-updated", record: updated, result: null });
    });

    await waitFor(() => expect(consultationGet).toHaveBeenCalledTimes(1));
    expect(consultationGet).toHaveBeenCalledWith({ id: "c-1" });
    expect(await screen.findByText("Budget data not available")).toBeTruthy();
    expect(await screen.findByText("Campaign plan not available")).toBeTruthy();
    expect(await screen.findByText("1 stale data source(s)")).toBeTruthy();
    expect(await screen.findByText("Google Ads source is stale")).toBeTruthy();

    await act(async () => {
      eventListener?.({ type: "consultation-updated", record: updated, result: null });
    });
    expect(consultationGet).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "cancelled"] as const)("retries a %s panel from the panel card", async (status) => {
    const panel = makeRecord({
      id: "panel-1",
      consultationMode: "panel",
      resolvedRole: "panel",
      status,
      childThreadOrRunId: null,
      safeFailureMessage: status === "failed" ? "panel failed" : null,
      cancelledAt: status === "cancelled" ? "2026-07-21T10:06:00.000Z" : null,
    });
    consultationListForThread.mockResolvedValue({
      consultations: [panel],
      results: [],
      panelMembers: [],
      contextPackets: [],
    });

    render(<ConsultationDock threadId="t-1" />);
    const retry = await screen.findByRole("button", { name: /retry panel/i });
    fireEvent.click(retry);
    await waitFor(() => expect(consultationRetry).toHaveBeenCalledWith({ id: "panel-1" }));
  });

  it.each(["queued", "running", "completed"] as const)("does not show panel retry while status is %s", async (status) => {
    const panel = makeRecord({
      id: "panel-1",
      consultationMode: "panel",
      resolvedRole: "panel",
      status,
      childThreadOrRunId: null,
      completedAt: status === "completed" ? "2026-07-21T10:06:00.000Z" : null,
    });
    consultationListForThread.mockResolvedValue({
      consultations: [panel],
      results: [],
      panelMembers: [],
      contextPackets: [],
    });

    render(<ConsultationDock threadId="t-1" />);
    await screen.findByText("verify these figures");
    expect(screen.queryByRole("button", { name: /retry panel/i })).toBeNull();
  });

  it("renders nothing when the thread has no consultations", async () => {
    consultationListForThread.mockResolvedValue({ consultations: [], results: [], panelMembers: [], contextPackets: [] });
    const { container } = render(<ConsultationDock threadId="t-empty" />);
    await waitFor(() => expect(consultationListForThread).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("preserves thread A cards when loading thread B", async () => {
    const recordA = makeRecord({ id: "c-a", parentThreadId: "t-a", originalInstruction: "verify A" });
    const recordB = makeRecord({ id: "c-b", parentThreadId: "t-b", originalInstruction: "verify B" });

    const storeState = useConsultationStore.getState;
    // Prime store with thread A's data.
    storeState().replaceRecordsForThread("t-a", [recordA]);
    storeState().replaceRecordsForThread("t-b", [recordB]);

    expect(storeState().records.has("c-a")).toBe(true);
    expect(storeState().records.has("c-b")).toBe(true);

    // Replace thread A records — this should NOT remove thread B.
    const updatedA = makeRecord({ id: "c-a", parentThreadId: "t-a", originalInstruction: "verify A", status: "completed", completedAt: "2026-07-22T01:00:00.000Z" });
    storeState().replaceRecordsForThread("t-a", [updatedA]);

    expect(storeState().records.has("c-a")).toBe(true);
    expect(storeState().records.has("c-b")).toBe(true);
    expect(storeState().records.get("c-a")?.status).toBe("completed");
    expect(storeState().records.get("c-b")?.originalInstruction).toBe("verify B");
  });
});
