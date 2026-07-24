import type { ConsultationRecord, ConsultationResultRecord, SuggestedProposalInput } from "./types";

/**
 * The SAFE structured result attached back to the parent thread. It carries only
 * curated, user-facing fields — never raw hidden reasoning / chain-of-thought.
 * This is the shape Worker 2's renderer consumes to render a consultation card.
 */
export interface ConsultationResultAttachment {
  consultationId: string;
  consultantLabel: string;
  role: ConsultationRecord["resolvedRole"];
  provider: string | null;
  model: string | null;
  consultationMode: ConsultationRecord["consultationMode"];
  status: ConsultationRecord["status"];
  summary: string;
  keyFindings: string[];
  evidenceReferences: string[];
  assumptions: string[];
  uncertainties: string[];
  recommendedActions: string[];
  suggestedProposalInputs: SuggestedProposalInput[];
  generatedFileReferences: string[];
  childThreadOrRunId: string | null;
  completedAt: string | null;
  failureCode: ConsultationRecord["failureCode"];
  safeFailureMessage: string | null;
}

/** A human-friendly label for a consultant from its role + provider. */
export function consultantLabel(record: ConsultationRecord): string {
  const provider = record.actualProvider ?? record.requestedProvider;
  const roleLabel = record.resolvedRole.replace(/_/g, " ");
  return provider ? `${roleLabel} · ${provider}` : roleLabel;
}

/**
 * Build the safe attachment from a consultation + its persisted result. When the
 * consultation failed/cancelled before producing a result, `result` may be
 * omitted and the attachment surfaces the safe failure message instead.
 */
export function buildResultAttachment(
  record: ConsultationRecord,
  result?: ConsultationResultRecord | null,
): ConsultationResultAttachment {
  return {
    consultationId: record.id,
    consultantLabel: consultantLabel(record),
    role: record.resolvedRole,
    provider: record.actualProvider ?? record.requestedProvider,
    model: record.actualModel ?? record.requestedModel,
    consultationMode: record.consultationMode,
    status: record.status,
    summary: result?.summary ?? record.safeFailureMessage ?? "",
    keyFindings: result?.keyFindings ?? [],
    evidenceReferences: result?.evidenceReferences ?? [],
    assumptions: result?.assumptions ?? [],
    uncertainties: result?.uncertainties ?? [],
    recommendedActions: result?.recommendedActions ?? [],
    suggestedProposalInputs: result?.suggestedProposalInputs ?? [],
    generatedFileReferences: result?.generatedFileReferences ?? [],
    childThreadOrRunId: record.childThreadOrRunId,
    completedAt: record.completedAt,
    failureCode: record.failureCode,
    safeFailureMessage: record.safeFailureMessage,
  };
}
