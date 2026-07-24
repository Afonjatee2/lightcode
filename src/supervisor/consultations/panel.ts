import type {
  ConsultationRecord,
  ConsultationResultRecord,
  PanelMembershipRecord,
  PanelCompletionRule,
} from "@/shared/consultations";
import { isTerminalStatus } from "@/shared/consultations";
import type { SynthesisBody } from "./finalise";

/**
 * Panel orchestration logic (Part 10). A panel is a durable parent consultation
 * backed by two or more REAL child consultations (never one model simulating
 * many reviewers). The completion rule decides when synthesis runs; the
 * synthesis preserves each member's independent view, surfaces disagreement, and
 * clearly identifies members that failed or were unavailable.
 */
export interface PanelMemberState {
  record: ConsultationRecord | null;
  requiredOrOptional: "required" | "optional";
}

/** True once the completion rule is satisfied by the current member states. */
export function panelCompletionMet(members: PanelMemberState[], rule: PanelCompletionRule): boolean {
  const settled = (record: ConsultationRecord | null): boolean =>
    record !== null && isTerminalStatus(record.status);
  switch (rule.kind) {
    case "all":
      return members.length > 0 && members.every((member) => settled(member.record));
    case "all_required": {
      const required = members.filter((member) => member.requiredOrOptional === "required");
      return required.length > 0 && required.every((member) => settled(member.record));
    }
    case "at_least":
      return members.filter((member) => member.record?.status === "completed").length >= rule.count;
    default:
      return false;
  }
}

export interface PanelMemberInput {
  membership: PanelMembershipRecord;
  record: ConsultationRecord | null;
  result: ConsultationResultRecord | null;
}

export function synthesisePanel(input: { instruction: string; members: PanelMemberInput[] }): SynthesisBody {
  const summaryParts: string[] = [];
  const keyFindings: string[] = [];
  const evidenceReferences: string[] = [];
  const assumptions: string[] = [];
  const uncertainties: string[] = [];
  const recommendedActions: string[] = [];
  const suggestedProposalInputs: SynthesisBody["suggestedProposalInputs"] = [];
  const generatedFileReferences: string[] = [];
  const unavailable: string[] = [];

  for (const { membership, record, result } of input.members) {
    const role = membership.memberRole;
    if (!record || !isTerminalStatus(record.status)) {
      unavailable.push(`${role} (did not settle)`);
      uncertainties.push(`[${role}] This panel member did not settle in time; its view is absent.`);
      continue;
    }
    if (record.status !== "completed" || !result) {
      unavailable.push(`${role} (${record.status})`);
      uncertainties.push(
        `[${role}] This panel member ${record.status === "cancelled" ? "was cancelled" : "failed"} and produced no result.`,
      );
      continue;
    }
    summaryParts.push(`- ${role}: ${result.summary}`);
    for (const finding of result.keyFindings) keyFindings.push(`[${role}] ${finding}`);
    evidenceReferences.push(...result.evidenceReferences);
    assumptions.push(...result.assumptions.map((item) => `[${role}] ${item}`));
    uncertainties.push(...result.uncertainties.map((item) => `[${role}] ${item}`));
    recommendedActions.push(...result.recommendedActions.map((item) => `[${role}] ${item}`));
    suggestedProposalInputs.push(...result.suggestedProposalInputs);
    generatedFileReferences.push(...result.generatedFileReferences);
  }

  const summaryLines = [
    `Panel synthesis (${input.members.length} members) for: ${input.instruction}`,
    "Each member's view is reported independently; disagreement is preserved rather than merged into a single verdict.",
    ...summaryParts,
  ];
  if (unavailable.length > 0) {
    summaryLines.push(`Unavailable or failed members: ${unavailable.join(", ")}.`);
  }
  if (recommendationsDisagree(input.members)) {
    summaryLines.push("Note: panel members differ on recommended actions; no consensus is asserted.");
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

function recommendationsDisagree(members: PanelMemberInput[]): boolean {
  const sets = members
    .filter((member) => member.result)
    .map((member) => (member.result?.recommendedActions ?? []).slice().sort().join("|"));
  const distinct = new Set(sets.filter((set) => set.length > 0));
  return distinct.size > 1;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
