/**
 * View-model types for the campaign workspace renderer components.
 *
 * These are UI-friendly projections of the Control Centre wire schemas,
 * intentionally different from the Layer-1 exact wire contract. The adapter
 * functions (mapCampaignContext / mapOperationsToday) transform wire data
 * into these shapes so renderer components never need to know CC field names.
 */

// ============================================================================
// Campaign Context View Model
// ============================================================================

export interface CampaignContextIdentityViewModel {
  campaignGroupId: string;
  campaignName: string;
  clientName: string | null;
  jobNumber: string | null;
  lifecycleStatus: string;
}

export interface CampaignContextDatesViewModel {
  startDate: string;
  endDate: string;
}

export interface CampaignContextBudgetViewModel {
  /** Hardcoded "GBP" — CC does not send currency. */
  currency: "GBP";
  totalBudget: number | null;
  spentToDate: number;
  remaining: number | null;
  /** Percentage (0-100) or null. Derived from CC field `percentUsed` (a 0-1 fraction) scaled to 0-100. */
  pctUsed: number | null;
}

export interface CampaignContextKpiViewModel {
  id: string;
  metricKey: string;
  /** Falls back to metricKey since CC has no separate label. */
  label: string;
  targetType: string;
  targetValue: number;
  actualValue: number | null;
  pctAchieved: number | null;
  status: string | null;
}

export interface CampaignContextPacingViewModel {
  status: string;
  variancePct: number | undefined;
  note: string | undefined;
}

export interface CampaignContextChannelViewModel {
  id: string;
  channelLabel: string;
  platform: string;
  plannedBudget: number | null;
  actualSpend: number;
  status: string | null;
}

export type SourceHealthStatus = "healthy" | "stale" | "failed" | "unknown";

export interface CampaignContextSourceHealthViewModel {
  sourceId: string;
  label: string;
  status: SourceHealthStatus;
  lastSyncedAt: string | null;
  reason: string | null;
}

export interface CampaignContextAlertViewModel {
  id: string;
  title: string;
  severity: string;
  priority: "P1" | "P2" | "P3" | "P4";
  openedAt: string;
}

export interface CampaignContextDecisionViewModel {
  id: string;
  title: string;
  decisionType: string;
  status: string;
  createdAt: string;
}

/**
 * A campaign decision projected for the workspace panel. Sourced from
 * `get_campaign_decisions` (not the narrow context-packet summary), so it
 * carries the validity window and the server-resolved `effectiveStatus`.
 * `isActive` mirrors `effectiveStatus` verbatim — the client never re-derives
 * active/expired from timestamps; the server is the sole authority.
 */
export interface CampaignDecisionViewModel {
  id: string;
  title: string;
  description: string | null;
  decisionType: string;
  status: "active" | "expired" | "revoked";
  effectiveStatus: "active" | "expired" | "revoked";
  isActive: boolean;
  /** Server-assigned window start (ISO). */
  startsAt: string;
  /** ISO, or null for an open-ended decision. */
  expiresAt: string | null;
}

export interface CampaignContextProposalViewModel {
  id: string;
  title: string;
  status: string;
  riskLevel: string | null;
  createdAt: string;
}

export interface CampaignContextEventViewModel {
  id: string;
  eventType: string;
  /** Falls back to event.title when description is null. */
  summary: string;
  occurredAt: string;
}

export interface CampaignContextViewModel {
  identity: CampaignContextIdentityViewModel;
  dates: CampaignContextDatesViewModel;
  budget: CampaignContextBudgetViewModel;
  kpis: CampaignContextKpiViewModel[];
  pacing: CampaignContextPacingViewModel;
  channels: CampaignContextChannelViewModel[];
  sourceHealth: CampaignContextSourceHealthViewModel[];
  openAlerts: CampaignContextAlertViewModel[];
  activeDecisions: CampaignContextDecisionViewModel[];
  pendingProposals: CampaignContextProposalViewModel[];
  recentEvents: CampaignContextEventViewModel[];
  evidenceFreshness: string;
  /** Derived warnings — never on the wire contract. */
  missingDataWarnings: string[];
  /** CC does NOT send this on context — undefined here. */
  generatedAt: undefined;
  /** Passthrough from CC wire. */
  suggestedQuestions: string[];
}

// ============================================================================
// Operations Today View Model
// ============================================================================

export interface OperationsTodayCampaignViewModel {
  campaignGroupId: string;
  clientName: string;
  campaignName: string;
  lifecycleStatus: string;
  deliveryState: string;
  attentionReason: string | undefined;
  openAlertCount: number;
  pendingProposalCount: number;
  sourceHealthSummary: string;
  lastSyncedAt: string | null;
  topPriority?: "P1" | "P2" | "P3" | "P4";
}

export interface OperationsTodayCountsViewModel {
  needsAttention: number;
  waitingForApproval: number;
  otherLive: number;
  total: number;
}

export interface OperationsTodayRecentlyResolvedViewModel {
  campaignGroupId: string;
  name: string;
  alertId: string;
  resolvedAt: string;
}

export interface OperationsTodaySourceHealthSummaryViewModel {
  healthy: number;
  stale: number;
  failed: number;
}

export interface OperationsTodayViewModel {
  needsAttention: OperationsTodayCampaignViewModel[];
  waitingForApproval: OperationsTodayCampaignViewModel[];
  otherLive: OperationsTodayCampaignViewModel[];
  counts: OperationsTodayCountsViewModel;
  generatedAt: string;
  healthyCampaignCount: number;
  sourceHealthSummary: OperationsTodaySourceHealthSummaryViewModel;
  recentlyResolved: OperationsTodayRecentlyResolvedViewModel[];
}
