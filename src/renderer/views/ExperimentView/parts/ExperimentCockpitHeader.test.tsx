import type { ComponentProps } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ExperimentCockpitHeader } from "./ExperimentCockpitHeader";

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    getExperimentCandidateStats: () => new Promise<never>(() => {}),
  }),
}));

const longPrompt = [
  "Refactor the reporting module so the month selector drives every chart.",
  "Keep the existing URL contract intact while moving the state into the store.",
  "Add regression coverage for the quarter boundaries and the empty state.",
  "Do not touch the billing module; it shares the chart components but must keep its own state.",
  "Finish with a short summary of the public API changes.",
].join("\n");
// testing-library normalizes element text (whitespace collapsed) but compares
// string matchers verbatim, so query with the collapsed form.
const collapsedPrompt = longPrompt.replace(/\n/g, " ");

function renderHeader(overrides: Partial<ComponentProps<typeof ExperimentCockpitHeader>> = {}) {
  return render(
    <ExperimentCockpitHeader
      title="Compare candidates"
      prompt={longPrompt}
      baseBranch="main"
      candidateCount={3}
      overallStatus="running"
      activeView="board"
      onViewChange={() => undefined}
      operationLocked={false}
      operation={null}
      decided={false}
      hasAiResults={false}
      hasAvailableJudge={false}
      resultReadyCount={0}
      hasActiveCandidate={false}
      hasCleanupPending={false}
      onCrownOpen={() => undefined}
      onResultsOpen={() => undefined}
      onCleanup={() => undefined}
      onDiscard={() => undefined}
      onClose={() => undefined}
      {...overrides}
    />,
  );
}

describe("ExperimentCockpitHeader", () => {
  it("shows the prompt preview in Board mode", () => {
    renderHeader({ activeView: "board" });

    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.getByText(collapsedPrompt)).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows the prompt preview in Compare mode", () => {
    renderHeader({ activeView: "compare" });

    expect(screen.getByText(collapsedPrompt)).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("expands and collapses the prompt preview with Show more / Show less", () => {
    renderHeader();

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed preview clamps to two lines.
    expect(screen.getByText(collapsedPrompt).className).toContain("[-webkit-line-clamp:2]");

    fireEvent.click(toggle);
    const collapse = screen.getByRole("button", { name: "Show less" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(collapsedPrompt).className).not.toContain("[-webkit-line-clamp:2]");

    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders Ready to review for completed result-ready candidates", () => {
    renderHeader({ overallStatus: "ready-to-review", resultReadyCount: 2 });

    expect(screen.getByText("Ready to review")).toBeInTheDocument();
  });

  it("keeps the header actions wrapping instead of overflowing", () => {
    const { container } = renderHeader({ hasAiResults: true, hasAvailableJudge: true });

    const actionRow = container.querySelector(".ml-auto");
    expect(actionRow?.className).toContain("flex-wrap");
  });
});
