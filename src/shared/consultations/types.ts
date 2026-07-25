/**
 * Phase 4 campaign-consultation domain contracts.
 *
 * These types are the stable, provider-agnostic core shared between the
 * supervisor coordinator, the renderer UI (Worker 2) and the mention parser.
 * Every concept the task asks us to keep distinct is a separate field:
 * business role, requested vs actual provider, requested vs actual model,
 * consultation mode, permission policy version, status, parent thread,
 * child thread/run, campaign group and the retry relationship.
 */

export const CONSULTATION_ROLES = [
  "daily_operator",
  "strategic_reviewer",
  "figures_auditor",
  "researcher",
  "challenger",
  "verifier",
  "panel",
  "finaliser",
  "handoff_writer",
] as const;
export type ConsultationRole = (typeof CONSULTATION_ROLES)[number];

export const CONSULTATION_STATUSES = [
  "queued",
  "building_context",
  "ready",
  "running",
  "awaiting_input",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

/** Terminal statuses a consultation can never leave. */
export const TERMINAL_CONSULTATION_STATUSES: readonly ConsultationStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalStatus(status: ConsultationStatus): boolean {
  return TERMINAL_CONSULTATION_STATUSES.includes(status);
}

/**
 * Execution shape of a consultation, distinct from the business role:
 * - standard: a single consultant answers the request
 * - panel: two or more real consultants answer in parallel, then synthesise
 * - finalise: synthesise already-completed consultations into one record
 */
export const CONSULTATION_MODES = ["standard", "panel", "finalise"] as const;
export type ConsultationMode = (typeof CONSULTATION_MODES)[number];

/** Durable rule controlling when a real multi-member panel may synthesise. */
export type PanelCompletionRule =
  | { kind: "all_required" }
  | { kind: "all" }
  | { kind: "at_least"; count: number };

/**
 * Stable failure codes persisted on a failed consultation. Safe to surface to
 * the user; never carries secrets or raw provider errors verbatim.
 */
export const CONSULTATION_FAILURE_CODES = [
  "context_retrieval_failed",
  "provider_unavailable",
  "provider_warming_up",
  "auth_failure",
  "child_launch_failed",
  "execution_failed",
  "result_parse_failed",
  "permission_denied",
  "cancelled",
  "internal_error",
] as const;
export type ConsultationFailureCode = (typeof CONSULTATION_FAILURE_CODES)[number];

/** Version stamp for the permission policy a consultation was created under. */
export const PERMISSION_POLICY_VERSION = "campaign-consultation-policy-v1";

/** Contract version stamped onto every persisted context packet. */
export const CONTEXT_PACKET_CONTRACT_VERSION = "consultation-context-v1";

/**
 * The durable consultation record (mirrors the `consultations` table). Nullable
 * fields are `| null` (never optional/undefined) so they round-trip SQLite NULLs
 * cleanly under exactOptionalPropertyTypes.
 */
export interface ConsultationRecord {
  id: string;
  parentProjectId: string;
  parentThreadId: string;
  campaignGroupId: string;
  childThreadOrRunId: string | null;
  originalMention: string;
  originalInstruction: string;
  resolvedRole: ConsultationRole;
  requestedProvider: string | null;
  actualProvider: string | null;
  requestedModel: string | null;
  actualModel: string | null;
  consultationMode: ConsultationMode;
  status: ConsultationStatus;
  contextPacketId: string | null;
  permissionPolicyVersion: string;
  actor: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failureCode: ConsultationFailureCode | null;
  safeFailureMessage: string | null;
  resultSummaryId: string | null;
  retryOfConsultationId: string | null;
  /** Persisted only for panel consultations; absent/null for standard/finalise. */
  panelCompletionRule?: PanelCompletionRule | null;
}

/** A persisted context packet (mirrors `context_packets`). */
export interface ContextPacketRecord {
  id: string;
  consultationId: string;
  structuredContext: ConsultationContextPacketBody;
  contentHash: string;
  contractVersion: string;
  redactionMetadata: RedactionMetadata;
  evidenceFreshness: EvidenceFreshnessSummary;
  missingDataWarnings: string[];
  createdAt: string;
}

/** A persisted durable thread summary (mirrors `thread_summaries`). */
export interface ThreadSummaryRecord {
  id: string;
  threadId: string;
  summary: string;
  sourceCursor: string;
  provider: string;
  model: string;
  contentHash: string;
  createdAt: string;
}

/** A persisted consultation result (mirrors `consultation_results`). */
export interface ConsultationResultRecord {
  id: string;
  consultationId: string;
  summary: string;
  keyFindings: string[];
  evidenceReferences: string[];
  assumptions: string[];
  uncertainties: string[];
  recommendedActions: string[];
  suggestedProposalInputs: SuggestedProposalInput[];
  generatedFileReferences: string[];
  completedAt: string;
}

/** A persisted panel membership row (mirrors `panel_membership`). */
export interface PanelMembershipRecord {
  parentPanelConsultationId: string;
  childConsultationId: string;
  memberRole: ConsultationRole;
  requiredOrOptional: "required" | "optional";
  sequenceOrWeight: number;
}

/**
 * A suggested proposal input. Consultations may RETURN these but never apply
 * them — applying actions belongs to the Control Centre decision/proposal
 * lifecycle (Phase 5/6), which we deliberately do not replicate.
 */
export interface SuggestedProposalInput {
  title: string;
  rationale: string;
  scopeType: string;
  scopeId: string | null;
  suggestedChange: string;
}

export interface RedactionMetadata {
  redactedCount: number;
  redactedFields: string[];
  appliedAt: string;
}

export interface EvidenceFreshnessSummary {
  oldestCapturedAt: string | null;
  newestCapturedAt: string | null;
  staleSourceCount: number;
  statuses: Array<{ label: string; freshnessStatus: string }>;
}

/**
 * The structured body of a context packet. This is what the consulted agent
 * actually sees. It never includes hidden reasoning / chain-of-thought.
 */
export interface ConsultationContextPacketBody {
  parentRequest: string;
  explicitTask: string;
  relevantRecentConversation: ConversationTurn[];
  durableThreadSummary: string | null;
  campaignIdentity: {
    campaignGroupId: string;
    campaignName: string;
    clientName: string | null;
    status: string;
  };
  dates: { startDate: string; endDate: string };
  budget: {
    totalBudget: number | null;
    spentToDate: number;
    remaining: number | null;
    percentUsed: number | null;
    expectedPercentUsed: number | null;
    pacingStatus: string | null;
  };
  kpiEvidence: ConsultationKpi[];
  alerts: ConsultationAlert[];
  activeDecisions: ConsultationDecision[];
  pendingProposals: ConsultationProposal[];
  recentCampaignEvents: ConsultationEvent[];
  permittedAttachments: PermittedAttachment[];
  evidenceFreshness: EvidenceFreshnessSummary;
  missingDataWarnings: string[];
  permissionConstraints: string[];
  redactionMetadata: RedactionMetadata;
  createdAt: string;
  contractVersion: string;
  contentHash: string;
}

export interface ConversationTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  messageId: string | null;
  createdAt: string | null;
}

export interface PermittedAttachment {
  name: string;
  kind: string;
  excerpt: string;
}

/** Consultation-focused campaign-context shapes (decoupled from CC wire names). */
export interface ConsultationKpi {
  id: string;
  metricKey: string;
  targetType: string;
  targetValue: number;
  actualValue: number | null;
  percentAchieved: number | null;
  status: string | null;
}

export interface ConsultationChannel {
  id: string;
  channelLabel: string;
  platform: string;
  plannedBudget: number | null;
  actualSpend: number;
  status: string | null;
}

export interface ConsultationSourceHealth {
  sourceAccountId: string;
  sourceName: string;
  status: "healthy" | "stale" | "failed";
  lastSuccessfulSyncAt: string | null;
  reason: string | null;
}

export interface ConsultationAlert {
  id: string;
  title: string;
  severity: string;
  priority: string;
  openedAt: string;
}

export interface ConsultationDecision {
  id: string;
  statement: string;
  reason: string | null;
  scopeType: string;
  startsAt: string;
  expiresAt: string | null;
  sourceType: string;
  createdBy: string;
}

export interface ConsultationProposal {
  id: string;
  title: string;
  status: string;
  summary: string | null;
  createdAt: string;
}

export interface ConsultationEvent {
  id: string;
  eventType: string;
  description: string;
  occurredAt: string;
  severity: string | null;
}

export interface ConsultationEvidence {
  claimKey: string;
  statement: string;
  result: number | string | null;
  sources: Array<{
    sourceType: string;
    label: string;
    capturedAt: string | null;
    freshnessStatus: string;
  }>;
}
