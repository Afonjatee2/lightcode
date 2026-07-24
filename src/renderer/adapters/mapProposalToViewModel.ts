import type {
  ActionProposalViewModel,
  ProposalFieldChange,
  ProposalStatus,
} from "@/renderer/components/campaignDeployment";
import type { CampaignContextIdentityViewModel } from "@/renderer/adapters/campaignViewModels";
import type { ControlCentreProposal } from "@/shared/campaignDeployment";

function stringifyState(value: Record<string, unknown> | null | undefined): string | undefined {
  if (!value || Object.keys(value).length === 0) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fieldChangesFromProposal(proposal: ControlCentreProposal): ProposalFieldChange[] {
  const before = proposal.beforeState ?? {};
  const after = proposal.expectedAfterState ?? proposal.requestedChange ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: ProposalFieldChange[] = [];

  for (const field of keys) {
    const currentValue = before[field];
    const proposedValue = after[field];
    if (currentValue === proposedValue) continue;
    changes.push({
      field,
      currentValue: coerceFieldValue(currentValue),
      proposedValue: coerceFieldValue(proposedValue),
    });
  }

  return changes;
}

function coerceFieldValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function rollbackGuidanceText(
  guidance: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!guidance) return undefined;
  if (typeof guidance.summary === "string") return guidance.summary;
  return stringifyState(guidance);
}

function platformResponseText(
  response: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!response) return undefined;
  if (typeof response.summary === "string") return response.summary;
  return stringifyState(response);
}

function errorDetailsText(details: Record<string, unknown> | null | undefined): string | undefined {
  if (!details) return undefined;
  if (typeof details.message === "string") return details.message;
  return stringifyState(details);
}

function mapProposalStatus(status: ControlCentreProposal["status"]): ProposalStatus {
  if (status === "expired") return "cancelled";
  return status;
}

/**
 * Maps a normalised Control Centre proposal (post-adapter) into the approval
 * docket view model. Overlapping lifecycle fields align with
 * `CampaignActionProposal` in `src/shared/contracts/campaign/campaignActionProposal.ts`;
 * the deployment client carries additional server-side state (applying, evidence
 * packet refs, platform response) that the docket renders verbatim.
 */
export function mapProposalToViewModel(
  proposal: ControlCentreProposal,
  identity: CampaignContextIdentityViewModel,
): ActionProposalViewModel {
  const target = proposal.target ?? {};
  const decidedAt = proposal.approvedAt ?? proposal.rejectedAt ?? undefined;
  const decidedBy = undefined;

  const platformResponse = platformResponseText(proposal.platformResponse);
  const errorDetails = errorDetailsText(proposal.errorDetails);

  const applyResult =
    proposal.status === "applied" || proposal.status === "failed"
      ? {
          outcome: proposal.status === "applied" ? ("applied" as const) : ("failed" as const),
          ...(proposal.appliedAt ? { appliedAt: proposal.appliedAt } : {}),
          ...(platformResponse ? { platformResponse } : {}),
          ...(errorDetails ? { errorDetails } : {}),
        }
      : undefined;

  const beforeStateNote = stringifyState(proposal.beforeState);
  const proposedStateNote = stringifyState(proposal.expectedAfterState ?? proposal.requestedChange);
  const rollbackGuidance = rollbackGuidanceText(proposal.rollbackGuidance);

  return {
    id: proposal.id,
    campaignGroupId: proposal.campaignGroupId,
    clientName: identity.clientName ?? "—",
    campaignName: identity.campaignName,
    ...(identity.jobNumber ? { jobNumber: identity.jobNumber } : {}),
    actionType: proposal.actionType,
    title: proposal.title,
    ...(proposal.summary ? { summary: proposal.summary } : {}),
    target: {
      platform: String(target.platform ?? "unknown"),
      entityType: String(target.entityType ?? "unknown"),
      entityId: String(target.entityId ?? "unknown"),
      ...(target.entityName ? { entityName: String(target.entityName) } : {}),
    },
    ...(proposal.summary ? { requestedChangeSummary: proposal.summary } : {}),
    fieldChanges: fieldChangesFromProposal(proposal),
    ...(beforeStateNote ? { beforeStateNote } : {}),
    ...(proposedStateNote ? { proposedStateNote } : {}),
    evidence: {
      packetId: proposal.evidencePacketId ?? "—",
      items: [],
      sources: [],
      calculations: [],
    },
    createdAt: proposal.createdAt ?? new Date(0).toISOString(),
    ...(proposal.expiresAt ? { expiresAt: proposal.expiresAt } : {}),
    risk: {
      level: proposal.riskLevel,
      reasons: proposal.riskReasons,
      requiresStrongConfirmation: proposal.requiresStrongConfirmation,
    },
    status: mapProposalStatus(proposal.status),
    ...(rollbackGuidance ? { rollbackGuidance } : {}),
    ...(decidedBy ? { decidedBy } : {}),
    ...(decidedAt ? { decidedAt } : {}),
    ...(proposal.approvalNote ? { approvalNote: proposal.approvalNote } : {}),
    ...(proposal.rejectionReason ? { rejectionReason: proposal.rejectionReason } : {}),
    ...(applyResult ? { applyResult } : {}),
  };
}
