import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { CampaignDecisionViewModel } from "@/renderer/adapters/campaignViewModels";
import type { CampaignDecisionsState } from "@/renderer/hooks/useCampaignDecisions";
import { CampaignDecisionsList } from "./CampaignDecisionsList";

const activeDecision: CampaignDecisionViewModel = {
  id: "a1",
  title: "Allow TikTok to run 30% ahead of pace",
  description: "Launch week front-loaded",
  decisionType: "pacing_exception",
  status: "active",
  effectiveStatus: "active",
  isActive: true,
  startsAt: "2026-07-15T09:00:00.000Z",
  expiresAt: "2026-07-22T23:00:00.000Z",
};

const expiredDecision: CampaignDecisionViewModel = {
  id: "e1",
  title: "Weekend spike was fine",
  description: null,
  decisionType: "pacing_exception",
  status: "active",
  effectiveStatus: "expired",
  isActive: false,
  startsAt: "2026-06-01T00:00:00.000Z",
  expiresAt: "2026-06-08T00:00:00.000Z",
};

function readyState(data: CampaignDecisionViewModel[]): CampaignDecisionsState {
  return { status: "ready", data };
}

describe("CampaignDecisionsList", () => {
  it("counts and lists only active decisions as active, showing their window", () => {
    render(
      <CampaignDecisionsList
        decisions={readyState([activeDecision, expiredDecision])}
        ready
        onRecord={() => {}}
      />,
    );

    expect(screen.getByText("1 active decisions")).toBeTruthy();
    expect(screen.getByText("Allow TikTok to run 30% ahead of pace")).toBeTruthy();
    // Each decision (active and past) renders its validity window (start → expiry).
    expect(screen.getAllByText(/→/)).toHaveLength(2);
  });

  it("keeps an expired decision below, marked expired — never presented as active", () => {
    render(
      <CampaignDecisionsList
        decisions={readyState([activeDecision, expiredDecision])}
        ready
        onRecord={() => {}}
      />,
    );

    expect(screen.getByText("Past decisions")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("shows an empty state when there are no active decisions", () => {
    render(
      <CampaignDecisionsList decisions={readyState([expiredDecision])} ready onRecord={() => {}} />,
    );
    expect(screen.getByText("0 active decisions")).toBeTruthy();
    expect(screen.getByText("No active decisions.")).toBeTruthy();
  });

  it("invokes onRecord when the Record button is pressed", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onRecord = vi.fn<() => void>();
    render(<CampaignDecisionsList decisions={readyState([])} ready onRecord={onRecord} />);
    fireEvent.click(screen.getByRole("button", { name: "Record a decision" }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });
});
