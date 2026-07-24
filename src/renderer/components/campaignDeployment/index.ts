/**
 * Barrel export for the campaign action-approval docket surface.
 *
 * The root `ApprovalDocket` component composes all presentational parts
 * (header, change comparison, evidence, risk, outcome, decision controls)
 * and manages the full lifecycle state machine. Consumers wire it by
 * normalising server state into `ActionProposalViewModel` and injecting
 * `ActionProposalCallbacks`.
 */

export { ApprovalDocket } from "./ApprovalDocket";
export type { ApprovalDocketProps } from "./ApprovalDocket";

// View-model types (consumers need these to normalise server state).
export type {
  ActionProposalViewModel,
  ActionProposalCallbacks,
  ApproveProposalInput,
  RejectProposalInput,
  RefreshProposalInput,
  ProposalApplyResult,
  ProposalCalculation,
  ProposalEvidence,
  ProposalEvidenceItem,
  ProposalEvidenceSource,
  ProposalFieldChange,
  ProposalFieldValue,
  ProposalRiskLevel,
  ProposalStatus,
} from "./actionProposalViewModel";

// Helper predicates + formatters (consumers may use these outside the docket).
export {
  STRONG_CONFIRMATION_PHRASE,
  formatDocketDateTime,
  formatDocketValue,
  isProposalActionable,
  isProposalExpired,
  isStrongConfirmationRequired,
  isTerminalStatus,
} from "./actionProposalViewModel";

// Lingui descriptors (consumers can reuse the same msgids elsewhere if needed).
export {
  docketStrings,
  evidenceKindStrings,
  proposalRiskStrings,
  proposalStatusStrings,
} from "./approvalDocketStrings";
