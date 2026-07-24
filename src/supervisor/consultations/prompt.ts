import type { ConsultationContextPacketBody, ConsultationMode, ConsultationRole } from "@/shared/consultations";

/**
 * Render a persisted context packet into the self-contained prompt handed to the
 * consultant's child run. The child shares no conversation with the parent, so
 * everything it needs is inlined. The trailing output contract matches the
 * sections {@link parseConsultationResult} extracts.
 */
export function buildConsultationPrompt(input: {
  role: ConsultationRole;
  mode: ConsultationMode;
  instruction: string;
  body: ConsultationContextPacketBody;
}): string {
  const { body } = input;
  const parts: string[] = [];

  parts.push(`## Task`, input.instruction, "");
  parts.push(`## Mode: ${input.mode}`, MODE_GUIDANCE[input.mode] ?? MODE_GUIDANCE.standard, "");
  parts.push(`## Your role`, `${input.role}.`, "");

  parts.push("## Campaign");
  parts.push(
    `- Name: ${body.campaignIdentity.campaignName}`,
    `- Client: ${body.campaignIdentity.clientName ?? "unknown"}`,
    `- Status: ${body.campaignIdentity.status}`,
    `- Dates: ${body.dates.startDate} → ${body.dates.endDate}`,
    "",
  );

  parts.push("## Budget");
  parts.push(
    `- Total: ${body.budget.totalBudget ?? "unknown"}`,
    `- Spent to date: ${body.budget.spentToDate}`,
    `- Remaining: ${body.budget.remaining ?? "unknown"}`,
    `- Percent used: ${body.budget.percentUsed ?? "unknown"} (expected ${body.budget.expectedPercentUsed ?? "unknown"})`,
    `- Pacing: ${body.budget.pacingStatus ?? "unknown"}`,
    "",
  );

  if (body.kpiEvidence.length > 0) {
    parts.push("## KPI evidence");
    for (const kpi of body.kpiEvidence) {
      parts.push(
        `- ${kpi.metricKey}: target ${kpi.targetValue} (${kpi.targetType}), actual ${kpi.actualValue ?? "n/a"}, ${kpi.percentAchieved ?? "n/a"}% achieved, status ${kpi.status ?? "n/a"}`,
      );
    }
    parts.push("");
  }

  if (body.alerts.length > 0) {
    parts.push("## Open alerts");
    for (const alert of body.alerts) {
      parts.push(`- [${alert.severity}/${alert.priority}] ${alert.title} (opened ${alert.openedAt})`);
    }
    parts.push("");
  }

  if (body.activeDecisions.length > 0) {
    parts.push("## Active decisions");
    for (const decision of body.activeDecisions) {
      parts.push(`- ${decision.statement}${decision.reason ? ` — ${decision.reason}` : ""}`);
    }
    parts.push("");
  }

  if (body.pendingProposals.length > 0) {
    parts.push("## Pending proposals");
    for (const proposal of body.pendingProposals) {
      parts.push(`- ${proposal.title} (${proposal.status})`);
    }
    parts.push("");
  }

  if (body.recentCampaignEvents.length > 0) {
    parts.push("## Recent campaign events");
    for (const event of body.recentCampaignEvents) {
      parts.push(`- ${event.occurredAt} ${event.eventType}: ${event.description}`);
    }
    parts.push("");
  }

  if (body.durableThreadSummary) {
    parts.push("## Conversation summary so far", body.durableThreadSummary, "");
  }

  if (body.relevantRecentConversation.length > 0) {
    parts.push("## Relevant recent conversation");
    for (const turn of body.relevantRecentConversation) {
      parts.push(`- ${turn.role}: ${turn.content}`);
    }
    parts.push("");
  }

  if (body.permittedAttachments.length > 0) {
    parts.push("## Permitted attachments");
    for (const attachment of body.permittedAttachments) {
      parts.push(`- ${attachment.name} (${attachment.kind}): ${attachment.excerpt}`);
    }
    parts.push("");
  }

  parts.push("## Evidence freshness");
  parts.push(
    `- Oldest evidence captured: ${body.evidenceFreshness.oldestCapturedAt ?? "unknown"}`,
    `- Newest evidence captured: ${body.evidenceFreshness.newestCapturedAt ?? "unknown"}`,
    `- Stale sources: ${body.evidenceFreshness.staleSourceCount}`,
    "",
  );

  if (body.missingDataWarnings.length > 0) {
    parts.push("## Missing-data warnings");
    for (const warning of body.missingDataWarnings) parts.push(`- ${warning}`);
    parts.push("");
  }

  parts.push("## Permission constraints");
  for (const constraint of body.permissionConstraints) parts.push(`- ${constraint}`);
  parts.push("");

  parts.push(
    "## Output contract",
    "Respond using exactly these markdown sections:",
    "## Summary",
    "## Key Findings",
    "## Evidence",
    "## Assumptions",
    "## Uncertainties",
    "## Recommendations",
    "## Suggested Proposal Inputs (optional JSON array of {title, rationale, scopeType, scopeId, suggestedChange})",
    "Do not include hidden reasoning or chain-of-thought.",
  );

  return parts.join("\n");
}

const MODE_GUIDANCE: Record<ConsultationMode, string> = {
  standard: "Provide a thorough, evidence-led analysis with actionable recommendations.",
  panel: "You are one reviewer on a panel; give your independent view so disagreement is preserved.",
  finalise: "Synthesise the completed consultations into one record without inventing consensus.",
};
