import type { ConsultationResultRecord, SuggestedProposalInput } from "@/shared/consultations";

/**
 * Parse a child consultant's raw concluding output into the SAFE structured
 * result we persist and attach to the parent. Only curated sections are
 * extracted — hidden reasoning / chain-of-thought is never captured. Throws
 * {@link ResultParseError} when there is nothing usable to summarise.
 */
export class ResultParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultParseError";
  }
}

export function parseConsultationResult(input: {
  id: string;
  consultationId: string;
  rawOutput: string;
  completedAt: string;
}): ConsultationResultRecord {
  const text = input.rawOutput.trim();
  if (text.length === 0) {
    throw new ResultParseError("Child consultation produced no output to summarise");
  }

  const summary = extractSection(text, "Summary") ?? firstParagraph(text);
  if (summary.length === 0) {
    throw new ResultParseError("Child consultation output contained no extractable summary");
  }

  return {
    id: input.id,
    consultationId: input.consultationId,
    summary,
    keyFindings: extractList(text, "Key Findings"),
    evidenceReferences: extractList(text, "Evidence"),
    assumptions: extractList(text, "Assumptions"),
    uncertainties: extractList(text, "Uncertainties"),
    recommendedActions: extractList(text, "Recommendations"),
    suggestedProposalInputs: extractProposalInputs(text),
    generatedFileReferences: extractList(text, "Generated Files"),
    completedAt: input.completedAt,
  };
}

function firstParagraph(text: string): string {
  const stripped = text.replace(/^#+\s.*$/gm, "").trim();
  const paragraph = stripped.split(/\n\s*\n/)[0];
  return (paragraph ?? "").trim();
}

function extractSection(text: string, name: string): string | null {
  const regex = new RegExp(`##\\s+${escapeRegex(name)}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, "i");
  const match = text.match(regex);
  if (!match || !match[1]) return null;
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}

function extractList(text: string, name: string): string[] {
  const section = extractSection(text, name);
  if (!section) return [];
  const items: string[] = [];
  for (const line of section.split("\n")) {
    const match = line.trim().match(/^[-*]\s+(.+)$/) ?? line.trim().match(/^\d+\.\s+(.+)$/);
    if (match && match[1] && match[1].trim().length > 0) items.push(match[1].trim());
  }
  return items;
}

function extractProposalInputs(text: string): SuggestedProposalInput[] {
  const section = extractSection(text, "Suggested Proposal Inputs");
  if (!section) return [];
  const jsonMatch = section.match(/```json\s*([\s\S]*?)```/i) ?? section.match(/(\[[\s\S]*\])/);
  if (!jsonMatch || !jsonMatch[1]) return [];
  try {
    const parsed = JSON.parse(jsonMatch[1]) as unknown;
    if (!Array.isArray(parsed)) return [];
    const inputs: SuggestedProposalInput[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.title !== "string") continue;
      inputs.push({
        title: item.title,
        rationale: typeof item.rationale === "string" ? item.rationale : "",
        scopeType: typeof item.scopeType === "string" ? item.scopeType : "campaign",
        scopeId: typeof item.scopeId === "string" ? item.scopeId : null,
        suggestedChange: typeof item.suggestedChange === "string" ? item.suggestedChange : "",
      });
    }
    return inputs;
  } catch {
    return [];
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
