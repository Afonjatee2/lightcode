import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalDocket } from "./ApprovalDocket";
import type { ApprovalDocketProps } from "./ApprovalDocket";
import {
  STRONG_CONFIRMATION_PHRASE,
  type ActionProposalViewModel,
} from "./actionProposalViewModel";
import { docketStrings } from "./approvalDocketStrings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a Lingui `MessageDescriptor` to the English fallback text that
 * renders under test (the source catalog). The msgid is the descriptor's
 * `message` property; we match loosely against the rendered text.
 */
function msg(value: { message?: string }): string {
  return value.message ?? "";
}

/** Fixed clock so expiry tests are deterministic. */
const FIXED_NOW = new Date("2026-07-22T12:00:00Z");
const FUTURE_EXPIRY = "2026-08-01T00:00:00Z";
const PAST_EXPIRY = "2026-01-01T00:00:00Z";

function makeProposal(overrides: Partial<ActionProposalViewModel> = {}): ActionProposalViewModel {
  return {
    id: "prop-001",
    campaignGroupId: "cg-001",
    clientName: "AIB NI",
    campaignName: "Q3 Brand Burst",
    jobNumber: "JOB-2026-042",
    actionType: "adjust_budget",
    title: "Increase YouTube daily budget by 20%",
    summary: "Daily pacing suggests headroom; CPA is £3.12 vs target £3.50.",
    target: {
      platform: "google_ads",
      entityType: "campaign",
      entityId: "ga:987654321",
      entityName: "YT_Brand_Q3_Prospecting",
    },
    requestedChangeSummary:
      "Raise the campaign daily budget from £500 to £600 to capture additional in-market impressions during the afternoon peak.",
    fieldChanges: [
      {
        field: "dailyBudget",
        label: "Daily budget",
        currentValue: 500,
        proposedValue: 600,
        unit: "GBP",
      },
      {
        field: "status",
        label: "Campaign status",
        currentValue: "ENABLED",
        proposedValue: "ENABLED",
      },
    ],
    beforeStateNote: "Current daily cap: £500. Pacing at 94% of budget with CPA under target.",
    proposedStateNote: "New daily cap: £600. Estimated +12% impressions, CPA projected at £3.25.",
    evidence: {
      packetId: "ev-20260722-001",
      question: "Is there budget headroom for this campaign?",
      generatedAt: "2026-07-22T10:30:00Z",
      provenance: "pacing-analysis-pipeline v2.4 · trailing 14 d",
      items: [
        {
          id: "evi-1",
          label: "7-day average CPA",
          kind: "metric",
          value: "£3.12 vs target £3.50",
          observedAt: "2026-07-21T23:59:00Z",
          reference: "google_ads:stats:987654321",
        },
        {
          id: "evi-2",
          label: "KPI threshold alert — CPA healthy",
          kind: "alert",
          value: "CPA trending 11% below target over 7 days",
          observedAt: "2026-07-22T06:00:00Z",
        },
      ],
      sources: [
        {
          id: "src-1",
          label: "Google Ads API",
          reference: "google_ads:1234567890",
          freshness: "2026-07-22T10:00:00Z",
        },
      ],
      calculations: [
        {
          id: "calc-1",
          label: "Projected CPA at £600 daily",
          expression: "projected_spend_30d / projected_conversions_30d",
          result: "£3.25",
          inputs: [
            { name: "projected_spend_30d", value: "18000" },
            { name: "projected_conversions_30d", value: "5538" },
          ],
        },
      ],
    },
    createdByAgent: "pacing-analyst-v2",
    createdAt: "2026-07-22T08:00:00Z",
    expiresAt: FUTURE_EXPIRY,
    risk: {
      level: "low",
      reasons: [],
      requiresStrongConfirmation: false,
    },
    status: "awaiting_approval",
    ...overrides,
  };
}

function makeCallbacks(): ApprovalDocketProps["callbacks"] {
  return {
    onApprove: vi.fn<ApprovalDocketProps["callbacks"]["onApprove"]>().mockResolvedValue(undefined),
    onReject: vi.fn<ApprovalDocketProps["callbacks"]["onReject"]>().mockResolvedValue(undefined),
    onRefresh: vi.fn<ApprovalDocketProps["callbacks"]["onRefresh"]>().mockResolvedValue(undefined),
  };
}

function renderDocket(props: Partial<ApprovalDocketProps> = {}) {
  const proposal = "proposal" in props ? props.proposal : makeProposal();
  const callbacks = props.callbacks ?? makeCallbacks();
  // Build props object conditionally so explicit `undefined` values aren't
  // passed for optional props (required by exactOptionalPropertyTypes).
  const jsxProps: Record<string, unknown> = { callbacks };
  if (proposal !== undefined) {
    jsxProps.proposal = proposal;
  }
  if ("loading" in props) jsxProps.loading = props.loading;
  if ("error" in props) jsxProps.error = props.error;
  if ("onRetry" in props) jsxProps.onRetry = props.onRetry;
  if ("now" in props) jsxProps.now = props.now;
  const result = render(<ApprovalDocket {...(jsxProps as ApprovalDocketProps)} />);
  return { ...result, callbacks };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalDocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // State switches
  // -----------------------------------------------------------------------

  describe("loading state", () => {
    it("renders a spinner and loading text", () => {
      renderDocket({ loading: true, proposal: null });
      expect(screen.getByTestId("docket-loading")).toBeInTheDocument();
      expect(screen.getByText(msg({ message: "Loading…" }))).toBeInTheDocument();
      expect(screen.queryByTestId("approval-docket")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders a no-selection message when no proposal and not loading", () => {
      renderDocket({ proposal: null, loading: false });
      expect(screen.getByTestId("docket-empty")).toBeInTheDocument();
      expect(screen.getByText(msg(docketStrings.emptyState))).toBeInTheDocument();
    });

    it("renders empty state for undefined proposal", () => {
      renderDocket({ proposal: undefined, loading: false });
      expect(screen.getByTestId("docket-empty")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders the error message and a retry button", () => {
      const onRetry = vi.fn<() => void>();
      renderDocket({ proposal: null, error: "Connection refused", onRetry });
      expect(screen.getByTestId("docket-error")).toBeInTheDocument();
      expect(screen.getByText("Connection refused")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("docket-retry-button"));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("renders error without retry button when onRetry is absent", () => {
      renderDocket({ proposal: null, error: "Boom" });
      expect(screen.getByTestId("docket-error")).toBeInTheDocument();
      expect(screen.queryByTestId("docket-retry-button")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Full render
  // -----------------------------------------------------------------------

  describe("full docket render", () => {
    it("renders all docket sections for an actionable proposal", () => {
      // Use a proposal with risk reasons, expected effect, and decision record
      // so all six sections (01–06) render.
      renderDocket({
        proposal: makeProposal({
          risk: {
            level: "medium",
            reasons: ["Budget delta exceeds threshold"],
            requiresStrongConfirmation: false,
          },
          expectedPlatformEffect: "Budget increases within 15 minutes.",
          decidedBy: "tee.afonja",
          decidedAt: "2026-07-22T10:00:00Z",
          approvalNote: "Approved after review.",
        }),
      });
      expect(screen.getByTestId("approval-docket")).toBeInTheDocument();

      // Sections 01–06 should all be present.
      for (const sec of ["01", "02", "03", "04", "05", "06"]) {
        expect(screen.getByTestId(`docket-section-${sec}`)).toBeInTheDocument();
      }
    });

    it("renders campaign and client metadata in the header", () => {
      renderDocket();
      expect(screen.getByText("AIB NI")).toBeInTheDocument();
      expect(screen.getByText("Q3 Brand Burst")).toBeInTheDocument();
      expect(screen.getByText("JOB-2026-042")).toBeInTheDocument();
      expect(screen.getByText("google_ads")).toBeInTheDocument();
      // Entity renders as "entityType · entityName"
      expect(screen.getByText(/YT_Brand_Q3_Prospecting/)).toBeInTheDocument();
      expect(screen.getByText("pacing-analyst-v2")).toBeInTheDocument();
    });

    it("renders title and summary", () => {
      renderDocket();
      expect(
        screen.getByRole("heading", { name: /Increase YouTube daily budget/ }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Daily pacing suggests headroom/)).toBeInTheDocument();
    });

    it("renders status and risk chips with the correct labels", () => {
      renderDocket({
        proposal: makeProposal({
          status: "awaiting_approval",
          risk: { level: "low", reasons: [], requiresStrongConfirmation: false },
        }),
      });
      expect(screen.getByText(msg({ message: "Awaiting approval" }))).toBeInTheDocument();
      expect(screen.getByText(msg({ message: "Low risk" }))).toBeInTheDocument();
    });

    it("renders field-level change comparison rows", () => {
      renderDocket();
      expect(screen.getByTestId("current-dailyBudget").textContent).toMatch(/500/);
      expect(screen.getByTestId("proposed-dailyBudget").textContent).toMatch(/600/);
    });

    it("renders evidence items, sources, and calculations", () => {
      renderDocket();
      expect(screen.getByText("7-day average CPA")).toBeInTheDocument();
      expect(screen.getByText("KPI threshold alert — CPA healthy")).toBeInTheDocument();
      expect(screen.getByText("Google Ads API")).toBeInTheDocument();
      expect(screen.getByText(/pacing-analysis-pipeline/)).toBeInTheDocument();
    });

    it("renders expected platform effect and rollback guidance when present", () => {
      renderDocket({
        proposal: makeProposal({
          expectedPlatformEffect: "Budget will increase by 20% within 15 minutes.",
          rollbackGuidance: "Run undo_budget_adjust for ga:987654321 with the previous £500 cap.",
        }),
      });
      expect(screen.getByText(/Budget will increase by 20%/)).toBeInTheDocument();
      expect(screen.getByText(/undo_budget_adjust/)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Expiry
  // -----------------------------------------------------------------------

  describe("expired proposal", () => {
    it("shows an expiry warning banner", () => {
      renderDocket({
        proposal: makeProposal({ expiresAt: PAST_EXPIRY }),
        now: FIXED_NOW,
      });
      expect(screen.getByText(msg(docketStrings.expiredWarning))).toBeInTheDocument();
    });

    it("suppresses the decision section for expired proposals", () => {
      renderDocket({
        proposal: makeProposal({ expiresAt: PAST_EXPIRY, status: "awaiting_approval" }),
        now: FIXED_NOW,
      });
      expect(screen.queryByTestId("docket-section-06")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    });

    it("shows an applying note for expired proposals that are still applying", () => {
      renderDocket({
        proposal: makeProposal({ expiresAt: PAST_EXPIRY, status: "applying" }),
        now: FIXED_NOW,
      });
      expect(screen.getByTestId("applying-note-expired")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Low-risk approve
  // -----------------------------------------------------------------------

  describe("low-risk approve", () => {
    it("calls onApprove and onRefresh when the operator approves without a note", async () => {
      const { callbacks } = renderDocket({
        proposal: makeProposal({
          risk: { level: "low", reasons: [], requiresStrongConfirmation: false },
          status: "awaiting_approval",
        }),
      });

      fireEvent.click(screen.getByRole("button", { name: /approve/i }));

      await waitFor(() => {
        expect(callbacks.onApprove).toHaveBeenCalledWith({
          proposalId: "prop-001",
        });
        expect(callbacks.onRefresh).toHaveBeenCalledWith({ proposalId: "prop-001" });
      });
    });

    it("forwards a typed approval note", async () => {
      const { callbacks } = renderDocket({
        proposal: makeProposal({
          risk: { level: "medium", reasons: [], requiresStrongConfirmation: false },
          status: "awaiting_approval",
        }),
      });

      const noteField = screen.getByPlaceholderText(msg(docketStrings.approvalNotePlaceholder));
      fireEvent.change(noteField, { target: { value: "Looks good — CPA is healthy." } });
      fireEvent.click(screen.getByRole("button", { name: /approve/i }));

      await waitFor(() => {
        expect(callbacks.onApprove).toHaveBeenCalledWith({
          proposalId: "prop-001",
          approvalNote: "Looks good — CPA is healthy.",
        });
      });
    });
  });

  // -----------------------------------------------------------------------
  // High-risk approve with strong confirmation
  // -----------------------------------------------------------------------

  describe("high-risk approve with strong confirmation", () => {
    const highRiskProposal = makeProposal({
      risk: {
        level: "high",
        reasons: ["Budget delta exceeds 15% threshold"],
        requiresStrongConfirmation: true,
      },
      status: "awaiting_approval",
    });

    it("opens the strong-confirmation dialog instead of calling onApprove immediately", () => {
      const { callbacks } = renderDocket({ proposal: highRiskProposal });

      fireEvent.click(screen.getByRole("button", { name: /approve with confirmation/i }));

      // The dialog should be visible; onApprove must not have fired yet.
      expect(screen.getByText(msg(docketStrings.strongConfirmTitle))).toBeInTheDocument();
      expect(callbacks.onApprove).not.toHaveBeenCalled();
    });

    it("confirms approval when the operator types the correct phrase", async () => {
      const { callbacks } = renderDocket({ proposal: highRiskProposal });

      fireEvent.click(screen.getByRole("button", { name: /approve with confirmation/i }));

      const phraseInput = screen.getByPlaceholderText(STRONG_CONFIRMATION_PHRASE);
      fireEvent.change(phraseInput, { target: { value: STRONG_CONFIRMATION_PHRASE } });

      fireEvent.click(
        screen.getByRole("button", { name: msg(docketStrings.confirmApprovalButton) }),
      );

      await waitFor(() => {
        expect(callbacks.onApprove).toHaveBeenCalledWith({
          proposalId: "prop-001",
          strongConfirmation: STRONG_CONFIRMATION_PHRASE,
        });
      });
    });

    it("forwards the approval note through the strong-confirmation flow", async () => {
      const { callbacks } = renderDocket({ proposal: highRiskProposal });

      const noteField = screen.getByPlaceholderText(msg(docketStrings.approvalNotePlaceholder));
      fireEvent.change(noteField, {
        target: { value: "Risk accepted after manual review." },
      });

      fireEvent.click(screen.getByRole("button", { name: /approve with confirmation/i }));

      const phraseInput = screen.getByPlaceholderText(STRONG_CONFIRMATION_PHRASE);
      fireEvent.change(phraseInput, { target: { value: STRONG_CONFIRMATION_PHRASE } });
      fireEvent.click(
        screen.getByRole("button", { name: msg(docketStrings.confirmApprovalButton) }),
      );

      await waitFor(() => {
        expect(callbacks.onApprove).toHaveBeenCalledWith({
          proposalId: "prop-001",
          approvalNote: "Risk accepted after manual review.",
          strongConfirmation: STRONG_CONFIRMATION_PHRASE,
        });
      });
    });

    it("disables the confirm button until the correct phrase is typed", () => {
      renderDocket({ proposal: highRiskProposal });

      fireEvent.click(screen.getByRole("button", { name: /approve with confirmation/i }));

      const confirmBtn = screen.getByRole("button", {
        name: msg(docketStrings.confirmApprovalButton),
      });
      expect(confirmBtn).toBeDisabled();

      const phraseInput = screen.getByPlaceholderText(STRONG_CONFIRMATION_PHRASE);
      fireEvent.change(phraseInput, { target: { value: "WRONG PHRASE" } });
      expect(confirmBtn).toBeDisabled();

      fireEvent.change(phraseInput, { target: { value: STRONG_CONFIRMATION_PHRASE } });
      expect(confirmBtn).toBeEnabled();
    });

    it("closes the dialog on cancel without calling onApprove", async () => {
      const { callbacks } = renderDocket({ proposal: highRiskProposal });

      fireEvent.click(screen.getByRole("button", { name: /approve with confirmation/i }));

      // Click Cancel in the dialog.
      const cancelBtn = screen.getByRole("button", { name: msg({ message: "Cancel" }) });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByText(msg(docketStrings.strongConfirmTitle))).not.toBeInTheDocument();
      });
      expect(callbacks.onApprove).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Reject
  // -----------------------------------------------------------------------

  describe("reject flow", () => {
    it("calls onReject and onRefresh when the operator rejects without a reason", async () => {
      const { callbacks } = renderDocket({
        proposal: makeProposal({ status: "awaiting_approval" }),
      });

      // Click "Reject…" to open the reject form.
      fireEvent.click(screen.getByRole("button", { name: /reject…/i }));
      // Click the danger "Reject" confirm button.
      fireEvent.click(screen.getByRole("button", { name: msg(docketStrings.rejectButton) }));

      await waitFor(() => {
        expect(callbacks.onReject).toHaveBeenCalledWith({
          proposalId: "prop-001",
        });
        expect(callbacks.onRefresh).toHaveBeenCalledWith({ proposalId: "prop-001" });
      });
    });

    it("forwards a typed rejection reason", async () => {
      const { callbacks } = renderDocket({
        proposal: makeProposal({ status: "awaiting_approval" }),
      });

      fireEvent.click(screen.getByRole("button", { name: /reject…/i }));

      const reasonField = screen.getByPlaceholderText(
        msg(docketStrings.rejectionReasonPlaceholder),
      );
      fireEvent.change(reasonField, {
        target: { value: "Budget increase not approved by client." },
      });
      fireEvent.click(screen.getByRole("button", { name: msg(docketStrings.rejectButton) }));

      await waitFor(() => {
        expect(callbacks.onReject).toHaveBeenCalledWith({
          proposalId: "prop-001",
          rejectionReason: "Budget increase not approved by client.",
        });
      });
    });

    it("cancels the reject form without calling onReject", () => {
      const { callbacks } = renderDocket({
        proposal: makeProposal({ status: "awaiting_approval" }),
      });

      fireEvent.click(screen.getByRole("button", { name: /reject…/i }));
      fireEvent.click(screen.getByRole("button", { name: msg({ message: "Cancel" }) }));

      // The reject form area should collapse; onReject must not have fired.
      expect(callbacks.onReject).not.toHaveBeenCalled();
      // The "Reject…" opener should be visible again.
      expect(screen.getByRole("button", { name: /reject…/i })).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Callback errors
  // -----------------------------------------------------------------------

  describe("callback error handling", () => {
    it("shows an error alert when onApprove rejects", async () => {
      const callbacks = makeCallbacks();
      (callbacks.onApprove as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API timeout"));

      renderDocket({
        proposal: makeProposal({
          risk: { level: "low", reasons: [], requiresStrongConfirmation: false },
          status: "awaiting_approval",
        }),
        callbacks,
      });

      fireEvent.click(screen.getByRole("button", { name: /approve/i }));

      await waitFor(() => {
        expect(screen.getByTestId("docket-submit-error")).toBeInTheDocument();
        expect(screen.getByText("API timeout")).toBeInTheDocument();
      });
    });

    it("clears the submit error when proposal identity changes", async () => {
      const callbacks = makeCallbacks();
      (callbacks.onApprove as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API timeout"));

      const { rerender } = render(
        <ApprovalDocket
          proposal={makeProposal({
            id: "prop-A",
            risk: { level: "low", reasons: [], requiresStrongConfirmation: false },
            status: "awaiting_approval",
          })}
          callbacks={callbacks}
          now={FIXED_NOW}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /approve/i }));
      await waitFor(() => {
        expect(screen.getByTestId("docket-submit-error")).toBeInTheDocument();
      });

      // Re-render with a different proposal id — the error should clear.
      rerender(
        <ApprovalDocket
          proposal={makeProposal({
            id: "prop-B",
            risk: { level: "low", reasons: [], requiresStrongConfirmation: false },
            status: "awaiting_approval",
          })}
          callbacks={callbacks}
          now={FIXED_NOW}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByTestId("docket-submit-error")).not.toBeInTheDocument();
      });
    });

    it("shows an error alert when onRefresh fails in the header", async () => {
      const callbacks = makeCallbacks();
      (callbacks.onRefresh as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error"),
      );

      renderDocket({ callbacks });

      const refreshBtn = screen.getByRole("button", {
        name: msg(docketStrings.refreshProposal),
      });
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(screen.getByTestId("docket-submit-error")).toBeInTheDocument();
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Terminal / read-only states
  // -----------------------------------------------------------------------

  describe("applying state", () => {
    it("shows the applying spinner note in the decision section", () => {
      renderDocket({ proposal: makeProposal({ status: "applying" }) });
      expect(screen.getByTestId("applying-note")).toBeInTheDocument();
      expect(screen.getByText(msg(docketStrings.applyingNote))).toBeInTheDocument();
    });
  });

  describe("applied state", () => {
    it("renders the apply result with platform response and audit reference", () => {
      renderDocket({
        proposal: makeProposal({
          status: "applied",
          decidedBy: "tee.afonja",
          decidedAt: "2026-07-22T11:00:00Z",
          approvalNote: "CPA trajectory supports the increase.",
          applyResult: {
            outcome: "applied",
            appliedAt: "2026-07-22T11:05:00Z",
            platformResponse: "Budget updated to 600 GBP micros via Google Ads API v17.",
            auditReference: "decision:d-20260722-001",
          },
        }),
      });

      expect(screen.getByText("tee.afonja")).toBeInTheDocument();
      expect(screen.getByText(/CPA trajectory supports the increase/)).toBeInTheDocument();
      expect(screen.getByText(/Budget updated to 600 GBP/)).toBeInTheDocument();
      expect(screen.getByText("decision:d-20260722-001")).toBeInTheDocument();
    });
  });

  describe("failed state", () => {
    it("renders error details from the apply result", () => {
      renderDocket({
        proposal: makeProposal({
          status: "failed",
          decidedBy: "tee.afonja",
          decidedAt: "2026-07-22T11:00:00Z",
          applyResult: {
            outcome: "failed",
            appliedAt: "2026-07-22T11:05:00Z",
            errorDetails:
              "Google Ads API error 403: insufficient permissions for budget modification.",
          },
        }),
      });

      expect(
        screen.getByText(/insufficient permissions for budget modification/),
      ).toBeInTheDocument();
    });
  });

  describe("already-decided states", () => {
    it.each(["approved", "rejected", "cancelled"] as const)(
      "shows no decision controls for status %s",
      (status) => {
        renderDocket({ proposal: makeProposal({ status }) });
        expect(screen.queryByTestId("docket-section-06")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
      },
    );
  });

  // -----------------------------------------------------------------------
  // Refresh
  // -----------------------------------------------------------------------

  describe("refresh", () => {
    it("calls onRefresh when the header refresh button is pressed", async () => {
      const { callbacks } = renderDocket();

      const refreshBtn = screen.getByRole("button", {
        name: msg(docketStrings.refreshProposal),
      });
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(callbacks.onRefresh).toHaveBeenCalledWith({ proposalId: "prop-001" });
      });
    });
  });

  // -----------------------------------------------------------------------
  // Disabled controls when busy
  // -----------------------------------------------------------------------

  describe("busy state", () => {
    it("calls onApprove and does not crash while pending", async () => {
      const callbacks = makeCallbacks();
      // Make the approve callback hang so we can observe the busy state.
      let resolveApprove: (v: unknown) => void;
      (callbacks.onApprove as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((resolve) => {
          resolveApprove = resolve;
        }),
      );

      renderDocket({
        proposal: makeProposal({
          risk: { level: "low", reasons: [], requiresStrongConfirmation: false },
          status: "awaiting_approval",
        }),
        callbacks,
      });

      fireEvent.click(screen.getByRole("button", { name: /approve/i }));

      // Confirm the callback was invoked (even though it hangs).
      expect(callbacks.onApprove).toHaveBeenCalledWith({
        proposalId: "prop-001",
      });

      // Resolve the pending promise to clean up.
      resolveApprove!(undefined);
    });
  });
});
