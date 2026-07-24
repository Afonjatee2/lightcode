import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildPlanDiffViewModel } from "@/shared/contracts/campaign/planIntelligence";
import { planIntelligenceCompareFixture } from "@/shared/contracts/campaign/fixtures/planIntelligenceCompare.fixture";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { PlanDiffView } from "./PlanDiffView";

describe("PlanDiffView", () => {
  const viewModel = buildPlanDiffViewModel({
    compare: planIntelligenceCompareFixture,
    candidateFilename: "media_plan_august_v2.xlsx",
    baseFilename: "media_plan_august_v6.xlsx",
  });

  it("renders summary chips, rows, filters, and provenance expansion", () => {
    render(
      <PlanDiffView
        viewModel={viewModel}
        filename="media_plan_august_v2.xlsx"
        onCreateProposal={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument();
    expect(screen.getByText("Meta · FTTP Interest")).toBeInTheDocument();
    expect(screen.getByText("Meta!D14")).toBeInTheDocument();
    expect(screen.getByTestId("plan-diff-filter-changed")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plan-diff-filter-added"));
    expect(screen.getByText("TikTok · LAL 1%")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plan-diff-filter-all"));
    fireEvent.click(screen.getByTestId(`plan-diff-row-field:line:Meta|FTTP Interest:budget`));
    expect(
      screen.getByTestId("plan-diff-provenance-field:line:Meta|FTTP Interest:budget"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cell-level provenance")).toBeInTheDocument();
  });

  it("shows create proposal affordance without publish controls", () => {
    const onCreateProposal = vi.fn<() => void>();
    render(
      <PlanDiffView
        viewModel={viewModel}
        filename="media_plan_august_v2.xlsx"
        onCreateProposal={onCreateProposal}
      />,
    );

    fireEvent.click(screen.getByTestId("plan-diff-create-proposal"));
    expect(onCreateProposal).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("plan-diff-publish")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-diff-apply")).not.toBeInTheDocument();
  });
});
