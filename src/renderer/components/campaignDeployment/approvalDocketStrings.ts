/**
 * Isolated Lingui descriptors for the approval docket.
 *
 * LOCALIZATION INTEGRATION TODO (do NOT edit locale catalogs here — they are
 * owned by another workstream): every descriptor below is a NEW msgid that
 * still needs catalog extraction and translation. The owning locale/catalog
 * workstream should run `pnpm i18n:extract` (see package.json) after this
 * module lands, then translate the new entries in
 * `src/renderer/locales/*‍/messages.po`. Until then Lingui falls back to the
 * source English msgid at runtime, which is safe.
 *
 * Where a suitable msgid already exists in the committed catalogs (e.g.
 * "Approve", "Cancel", "Refresh", "Retry", "Status", "Sources", "Notes",
 * "Loading…"), the components reuse it inline via `t`/`Trans` instead of
 * defining it here.
 */
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

import type { ProposalRiskLevel, ProposalStatus } from "./actionProposalViewModel";

export const docketStrings = {
  docketKicker: msg`Decision docket`,
  campaignClientHeading: msg`Campaign & client`,
  clientLabel: msg`Client`,
  campaignLabel: msg`Campaign`,
  jobNumberLabel: msg`Job no.`,
  platformLabel: msg`Platform`,
  entityLabel: msg`Entity`,
  actionTypeLabel: msg`Action type`,
  createdByLabel: msg`Proposed by`,
  createdLabel: msg`Created`,
  expiresLabel: msg`Expires`,
  expiredWarning: msg`This proposal has expired. The server will refuse further decisions.`,
  requestedChangeHeading: msg`Requested change`,
  fieldColumn: msg`Field`,
  currentColumn: msg`Current`,
  proposedColumn: msg`Proposed`,
  beforeStateLabel: msg`Before`,
  afterStateLabel: msg`After`,
  evidenceHeading: msg`Evidence`,
  evidenceEmpty: msg`No evidence attached`,
  evidencePacketLabel: msg`Evidence packet`,
  calculationsDisclosure: msg`Calculation details`,
  provenanceLabel: msg`Provenance`,
  generatedLabel: msg`Generated`,
  riskHeading: msg`Risk`,
  riskReasonsLabel: msg`Why this is risky`,
  strongConfirmationRequiredNote: msg`Approving requires strong confirmation.`,
  effectRollbackHeading: msg`Effect & rollback`,
  expectedEffectLabel: msg`Expected platform effect`,
  rollbackGuidanceLabel: msg`Rollback guidance`,
  outcomeHeading: msg`Outcome`,
  decisionRecordLabel: msg`Decision record`,
  decidedByLabel: msg`Decided by`,
  decidedAtLabel: msg`Decided at`,
  approvalNoteLabel: msg`Approval note`,
  rejectionReasonLabel: msg`Rejection reason`,
  applyResultLabel: msg`Apply result`,
  platformResponseLabel: msg`Platform response`,
  errorDetailsLabel: msg`Error details`,
  auditReferenceLabel: msg`Audit reference`,
  decisionHeading: msg`Decision`,
  approvalNotePlaceholder: msg`Optional note recorded with the approval`,
  rejectionReasonPlaceholder: msg`Optional reason recorded with the rejection`,
  rejectButton: msg`Reject`,
  approveHighRiskButton: msg`Approve with confirmation…`,
  strongConfirmTitle: msg`Confirm high-risk approval`,
  strongConfirmBody: msg`This proposal is high risk. Type the confirmation phrase to approve it.`,
  strongConfirmInputLabel: msg`Confirmation phrase`,
  confirmApprovalButton: msg`Confirm approval`,
  phraseMismatch: msg`The phrase does not match.`,
  emptyState: msg`No proposal selected`,
  errorStateTitle: msg`The proposal could not be loaded`,
  actionFailedTitle: msg`The decision could not be submitted`,
  applyingNote: msg`The approved change is being applied to the platform.`,
  appliedResult: msg`Applied`,
  yes: msg`Yes`,
  no: msg`No`,
  refreshProposal: msg`Refresh proposal`,
  lifecycleHeading: msg`Proposal lifecycle`,
  lifecycleDraft: msg`Draft`,
  lifecycleAwaiting: msg`Awaiting`,
  lifecycleApproved: msg`Approved`,
  lifecycleApplying: msg`Applying`,
  lifecycleApplied: msg`Applied`,
  backToThread: msg`Back to thread`,
  sourceFreshnessLine: msg`Source: {source} · {freshness}`,
  staleFreshnessCaution: msg`stale {age} — treated with caution`,
} satisfies Record<string, MessageDescriptor>;

/** Status chip labels — keyed by the server-returned lifecycle status. */
export const proposalStatusStrings: Record<ProposalStatus, MessageDescriptor> = {
  draft: msg`Draft`,
  awaiting_approval: msg`Awaiting approval`,
  approved: msg`Approved`,
  rejected: msg`Rejected`,
  applying: msg`Applying…`,
  applied: msg`Applied`,
  failed: msg`Failed`,
  cancelled: msg`Cancelled`,
};

/** Risk chip labels — keyed by the server-returned risk level. */
export const proposalRiskStrings: Record<ProposalRiskLevel, MessageDescriptor> = {
  low: msg`Low risk`,
  medium: msg`Medium risk`,
  high: msg`High risk`,
  critical: msg`Critical risk`,
};

/** Evidence kind labels. */
export const evidenceKindStrings: Record<string, MessageDescriptor> = {
  metric: msg`Metric`,
  alert: msg`Alert`,
  plan_fact: msg`Plan fact`,
  campaign_event: msg`Campaign event`,
  external: msg`External`,
};
