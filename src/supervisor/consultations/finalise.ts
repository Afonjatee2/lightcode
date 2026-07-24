import type { ConsultationRecord, ConsultationResultRecord } from "@/shared/consultations";

/**
 * Finalise synthesis (Part 11). Combines already-completed consultations into
 * one record while referencing their ids and preserving disagreements and
 * uncertainties — it never invents a consensus the consultants did not reach.
 */
export type SynthesisBody = Omit<ConsultationResultRecord, "id" | "consultationId" | "completedAt">;

export interface FinaliseInput {
  instruction: string;
  consultations: Array<{ record: ConsultationRecord; result: ConsultationResultRecord | null }>;
  skippedNonCompleted: Array<{ id: string; status: string }>;
}

export function synthesiseFinalise(input: FinaliseInput): SynthesisBody {
  const summaryParts: string[] = [];
  const keyFindings: string[] = [];
  const evidenceReferences: string[] = [];
  const assumptions: string[] = [];
  const uncertainties: string[] = [];
  const recommendedActions: string[] = [];
  const suggestedProposalInputs: SynthesisBody["suggestedProposalInputs"] = [];
  const generatedFileReferences: string[] = [];

  for (const { record, result } of input.consultations) {
    const label = `${record.resolvedRole} (${record.id})`;
    if (result) {
      summaryParts.push(`- ${label}: ${result.summary}`);
      for (const finding of result.keyFindings) keyFindings.push(`[${record.resolvedRole}] ${finding}`);
      evidenceReferences.push(...result.evidenceReferences);
      assumptions.push(...result.assumptions.map((item) => `[${record.resolvedRole}] ${item}`));
      uncertainties.push(...result.uncertainties.map((item) => `[${record.resolvedRole}] ${item}`));
      recommendedActions.push(...result.recommendedActions.map((item) => `[${record.resolvedRole}] ${item}`));
      suggestedProposalInputs.push(...result.suggestedProposalInputs);
      generatedFileReferences.push(...result.generatedFileReferences);
    } else {
      summaryParts.push(`- ${label}: (no structured result captured)`);
      uncertainties.push(`[${record.resolvedRole}] No structured result was captured for consultation ${record.id}.`);
    }
  }

  const summaryLines = [
    `Finalised synthesis of ${input.consultations.length} completed consultation(s) for: ${input.instruction}`,
    "Consultants are referenced by id; their conclusions are preserved and disagreements are NOT reconciled into a false consensus.",
    ...summaryParts,
  ];
  if (input.skippedNonCompleted.length > 0) {
    summaryLines.push(
      `Excluded ${input.skippedNonCompleted.length} non-completed consultation(s): ${input.skippedNonCompleted
        .map((skipped) => `${skipped.id} (${skipped.status})`)
        .join(", ")}.`,
    );
  }

  return {
    summary: summaryLines.join("\n"),
    keyFindings: dedupe(keyFindings),
    evidenceReferences: dedupe(evidenceReferences),
    assumptions: dedupe(assumptions),
    uncertainties: dedupe(uncertainties),
    recommendedActions: dedupe(recommendedActions),
    suggestedProposalInputs,
    generatedFileReferences: dedupe(generatedFileReferences),
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
