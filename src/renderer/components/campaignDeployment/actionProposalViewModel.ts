/**
 * Normalized view model + injected callback surface for the campaign action
 * proposal approval docket.
 *
 * This module is intentionally self-contained: it does NOT import the shared
 * campaign contracts (`@/shared/contracts/campaign/**`, owned by another
 * workstream) and it contains NO network code. The host (the existing
 * CampaignWorkspace, once wired) normalizes whatever the Control Centre API /
 * MCP tools return into `ActionProposalViewModel` and injects
 * `ActionProposalCallbacks`. The component renders server-returned state only
 * — it never fetches, never writes to an advertising platform, never
 * recomputes evidence, and never marks anything applied locally.
 *
 * Shape notes (aligned with the Control Centre Phase 5/6 proposal model):
 * - Lifecycle: draft → awaiting_approval → approved|rejected → applying →
 *   applied|failed (plus cancelled). The UI only acts on `awaiting_approval`.
 * - Risk: low|medium|high|critical; high/critical require a strong
 *   confirmation phrase that is forwarded verbatim to the approve callback.
 */

export type ProposalRiskLevel = "low" | "medium" | "high" | "critical";

export type ProposalStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "applying"
  | "applied"
  | "failed"
  | "cancelled";

/** Primitive value rendered in the before/after comparison. */
export type ProposalFieldValue = string | number | boolean | null;

/** A single field-level diff between current and proposed state. */
export type ProposalFieldChange = {
  /** Stable field key from the requested change payload, e.g. "dailyBudget". */
  field: string;
  /** Optional human label; falls back to `field` when absent. */
  label?: string;
  currentValue: ProposalFieldValue;
  proposedValue: ProposalFieldValue;
  /** Optional unit suffix rendered after the value, e.g. "GBP" or "%". */
  unit?: string;
};

/** One deterministic evidence item cited by the proposal. */
export type ProposalEvidenceItem = {
  id: string;
  label: string;
  kind: "metric" | "alert" | "plan_fact" | "campaign_event" | "external";
  /** Pre-rendered value/observation, e.g. "CPA £4.12 vs target £3.50". */
  value?: string;
  /** ISO timestamp of the underlying observation, when known. */
  observedAt?: string;
  /** Stable source reference (entity/table/report identifier). */
  reference?: string;
};

/** A data source the evidence packet was generated from. */
export type ProposalEvidenceSource = {
  id: string;
  label: string;
  /** Stable reference, e.g. "google_ads:1234567890" or a report id. */
  reference: string;
  /** Server-supplied freshness descriptor (ISO timestamp or label). */
  freshness?: string;
};

/**
 * A calculation the proposal relied on. `result` is computed server-side at
 * evidence-generation time; the docket displays it verbatim and NEVER
 * recomputes it.
 */
export type ProposalCalculation = {
  id: string;
  label: string;
  /** Human-readable expression, e.g. "spend_7d / days_elapsed". */
  expression: string;
  result: string;
  inputs?: { name: string; value: string }[];
};

/** Evidence block backing the proposal (normalized from an evidence packet). */
export type ProposalEvidence = {
  packetId: string;
  /** The question/brief the evidence packet was generated for. */
  question?: string;
  /** ISO timestamp of packet generation. */
  generatedAt?: string;
  /** Free-text provenance note (pipeline, agent, source window). */
  provenance?: string;
  items: ProposalEvidenceItem[];
  sources: ProposalEvidenceSource[];
  calculations: ProposalCalculation[];
};

/** Server-reported outcome of applying the proposal to the platform. */
export type ProposalApplyResult = {
  outcome: "applied" | "failed";
  appliedAt?: string;
  /** Raw platform/API response summary returned by the server. */
  platformResponse?: string;
  errorDetails?: string;
  /** Resulting audit/decision reference (e.g. campaign decision id). */
  auditReference?: string;
};

/** The normalized proposal everything in this folder renders. */
export type ActionProposalViewModel = {
  id: string;
  campaignGroupId: string;
  clientName: string;
  campaignName: string;
  jobNumber?: string;

  actionType: string;
  title: string;
  summary?: string;

  target: {
    platform: string;
    entityType: string;
    entityId: string;
    entityName?: string;
  };

  /** Narrative description of the requested change (server-authored). */
  requestedChangeSummary?: string;
  /** Field-level current vs proposed comparison. */
  fieldChanges: ProposalFieldChange[];
  /** Raw before/after state notes, when the server provides them. */
  beforeStateNote?: string;
  proposedStateNote?: string;

  evidence: ProposalEvidence;

  createdByAgent?: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO expiry timestamp; past expiry the server refuses transitions. */
  expiresAt?: string;

  risk: {
    level: ProposalRiskLevel;
    reasons: string[];
    requiresStrongConfirmation: boolean;
  };

  status: ProposalStatus;

  expectedPlatformEffect?: string;
  rollbackGuidance?: string;

  decidedBy?: string;
  decidedAt?: string;
  approvalNote?: string;
  rejectionReason?: string;

  applyResult?: ProposalApplyResult;
};

export type ApproveProposalInput = {
  proposalId: string;
  approvalNote?: string;
  /** Verbatim phrase typed by the operator for high/critical-risk proposals. */
  strongConfirmation?: string;
};

export type RejectProposalInput = {
  proposalId: string;
  rejectionReason?: string;
};

export type RefreshProposalInput = {
  proposalId: string;
};

/**
 * Injected adapter surface. The host implements these against its transport
 * (MCP tools / API client). Return values are treated as opaque — the docket
 * re-reads server state exclusively through the `proposal` prop and asks the
 * host to refresh after every successful decision.
 */
export type ActionProposalCallbacks = {
  onApprove: (input: ApproveProposalInput) => Promise<unknown>;
  onReject: (input: RejectProposalInput) => Promise<unknown>;
  onRefresh: (input: RefreshProposalInput) => Promise<unknown>;
};

/**
 * Fixed token the operator must type to strongly confirm a high/critical-risk
 * approval. Deliberately NOT localized — the same token is forwarded verbatim
 * to the server, so it must stay stable across locales.
 */
export const STRONG_CONFIRMATION_PHRASE = "APPROVE";

/** Strong confirmation is required for high/critical risk or when the server flags it. */
export function isStrongConfirmationRequired(risk: {
  level: ProposalRiskLevel;
  requiresStrongConfirmation: boolean;
}): boolean {
  return risk.requiresStrongConfirmation || risk.level === "high" || risk.level === "critical";
}

/** The docket only offers approve/reject while the server awaits a decision. */
export function isProposalActionable(status: ProposalStatus): boolean {
  return status === "awaiting_approval";
}

/** Statuses after which no further decision or application is expected. */
export function isTerminalStatus(status: ProposalStatus): boolean {
  return status === "applied" || status === "rejected" || status === "cancelled";
}

/** Expiry check against an injectable clock (tests pass a fixed `now`). */
export function isProposalExpired(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() <= now.getTime();
}

/** Locale-aware docket timestamp; returns `fallback` for invalid input. */
export function formatDocketDateTime(iso: string | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Renders a field value for the comparison table; booleans map via supplied labels. */
export function formatDocketValue(
  value: ProposalFieldValue,
  options: { unit?: string; yesLabel: string; noLabel: string; emptyLabel?: string },
): string {
  const empty = options.emptyLabel ?? "—";
  let rendered: string;
  if (value === null || value === "") {
    return empty;
  } else if (typeof value === "boolean") {
    rendered = value ? options.yesLabel : options.noLabel;
  } else if (typeof value === "number") {
    rendered = numberFormatter.format(value);
  } else {
    rendered = value;
  }
  return options.unit ? `${rendered} ${options.unit}` : rendered;
}
