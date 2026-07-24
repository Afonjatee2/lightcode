import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ConsultationCard } from "./ConsultationCard";
import type { ConsultationRecord, ConsultationResultAttachment, EvidenceFreshnessSummary } from "@/shared/consultations";

const noopCancel = vi.fn<(id: string) => void>();
const noopRetry = vi.fn<(id: string) => void>();
const noopNavigate = vi.fn<(childThreadOrRunId: string) => void>();
const FRESH_EVIDENCE: EvidenceFreshnessSummary = {
  oldestCapturedAt: "2026-07-20T00:00:00.000Z",
  newestCapturedAt: "2026-07-21T06:00:00.000Z",
  staleSourceCount: 0,
  statuses: [],
};

function makeRecord(overrides: Partial<ConsultationRecord> = {}): ConsultationRecord {
  return {
    id: "c-1",
    parentProjectId: "p-1",
    parentThreadId: "t-1",
    campaignGroupId: "cg-1",
    childThreadOrRunId: null,
    originalMention: "@codex check budget",
    originalInstruction: "check budget",
    resolvedRole: "daily_operator",
    requestedProvider: "codex",
    actualProvider: "codex",
    requestedModel: null,
    actualModel: "gpt-5",
    consultationMode: "standard",
    status: "queued",
    contextPacketId: null,
    permissionPolicyVersion: "v1",
    actor: "user",
    createdAt: "2026-07-21T10:00:00.000Z",
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    safeFailureMessage: null,
    resultSummaryId: null,
    retryOfConsultationId: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ConsultationResultAttachment> = {}): ConsultationResultAttachment {
  return {
    consultationId: "c-1",
    consultantLabel: "daily_operator · codex",
    role: "daily_operator",
    provider: "codex",
    model: "gpt-5",
    consultationMode: "standard",
    status: "completed",
    summary: "Budget looks good.",
    keyFindings: ["Pacing is on track"],
    evidenceReferences: [],
    assumptions: [],
    uncertainties: [],
    recommendedActions: ["Keep monitoring"],
    suggestedProposalInputs: [],
    generatedFileReferences: [],
    childThreadOrRunId: null,
    completedAt: "2026-07-21T10:05:00.000Z",
    failureCode: null,
    safeFailureMessage: null,
    ...overrides,
  };
}

describe("ConsultationCard — lifecycle states", () => {
  it("renders queued state", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "queued" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("check budget")).toBeTruthy();
  });

  it("renders building_context state with progress indicator", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "building_context" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("renders ready state", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "ready" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("renders running state with cancel button", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "running" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("renders awaiting_input state", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "awaiting_input" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("renders completed state with result", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "completed", completedAt: "2026-07-21T10:05:00.000Z" })}
        resultAttachment={makeResult()}
        evidenceFreshness={FRESH_EVIDENCE}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel={false}
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("Consultation complete")).toBeTruthy();
    expect(screen.getByText("Budget looks good.")).toBeTruthy();
    expect(screen.getByText("Key findings:")).toBeTruthy();
    expect(screen.getByText("Pacing is on track")).toBeTruthy();
    expect(screen.getByText("Keep monitoring")).toBeTruthy();
  });

  it("renders failed state with retry button", () => {
    render(
      <ConsultationCard
        record={makeRecord({
          status: "failed",
          failureCode: "execution_failed",
          safeFailureMessage: "Child execution failed",
        })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel={false}
        canRetry
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("Consultation failed")).toBeTruthy();
    expect(screen.getByText("Child execution failed")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("hides retry button when canRetry is false on failed", () => {
    render(
      <ConsultationCard
        record={makeRecord({
          status: "failed",
          failureCode: "execution_failed",
          safeFailureMessage: "Child execution failed",
        })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel={false}
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("renders cancel_requested state", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "cancel_requested" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel={false}
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("Cancelling")).toBeTruthy();
  });

  it("renders cancelled state", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "cancelled" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel={false}
        canRetry
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("Consultation was cancelled")).toBeTruthy();
  });

  it("hides cancel button in terminal states", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "completed" })}
        resultAttachment={makeResult()}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.queryByText("Cancel")).toBeNull();
  });

  it("shows child thread link when childThreadOrRunId is set", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "running", childThreadOrRunId: "thread-456" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("View child thread")).toBeTruthy();
  });

  it("hides Cancel and progress when consultation is terminal", () => {
    render(
      <ConsultationCard
        record={makeRecord({ status: "cancelled" })}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.queryByText("Cancel")).toBeNull();
    expect(screen.queryByText("In progress")).toBeNull();
  });
});

describe("ConsultationCard — context warnings", () => {
  it("shows Control Centre unavailable warning", () => {
    render(
      <ConsultationCard
        record={makeRecord()}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable={false}
      />,
    );
    expect(screen.getByText("Control Centre connection unavailable")).toBeTruthy();
  });

  it("shows budget unavailable warning", () => {
    render(
      <ConsultationCard
        record={makeRecord()}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget={false}
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("Budget data not available")).toBeTruthy();
  });

  it("shows plan unavailable warning", () => {
    render(
      <ConsultationCard
        record={makeRecord()}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan={false}
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("Campaign plan not available")).toBeTruthy();
  });

  it("shows stale evidence warning", () => {
    render(
      <ConsultationCard
        record={makeRecord()}
        resultAttachment={null}
        evidenceFreshness={{
          oldestCapturedAt: "2026-07-01T00:00:00.000Z",
          newestCapturedAt: "2026-07-21T00:00:00.000Z",
          staleSourceCount: 2,
          statuses: [],
        }}
        missingDataWarnings={[]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("2 stale data source(s)")).toBeTruthy();
  });

  it("shows permission restricted warning", () => {
    render(
      <ConsultationCard
        record={makeRecord()}
        resultAttachment={null}
        evidenceFreshness={null}
        missingDataWarnings={["KPI source inaccessible"]}
        onCancel={noopCancel}
        onRetry={noopRetry}
        onNavigateToChild={noopNavigate}
        canCancel
        canRetry={false}
        hasBudget
        hasPlan
        controlCentreAvailable
      />,
    );
    expect(screen.getByText("KPI source inaccessible")).toBeTruthy();
  });
});
