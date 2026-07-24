import { z } from "zod";
import type { ControlCentreProposal } from "./types";
import { controlCentreProposalSchema } from "./types";

// ---------------------------------------------------------------------------
// Raw shape from the MCP backend (dirty Phase 6 contract)
//
// The server may return fields like `beforeState`, `expectedAfterState`,
// `appliedAfterState` that are not in the old client contract but ARE in
// the Control Centre db schema. This adapter maps server responses into
// the canonical normalized shape.
// ---------------------------------------------------------------------------

/** Narrowed view of raw fields the server may include */
const rawServerRow = z
  .object({
    id: z.unknown(),
    campaign_group_id: z.unknown().optional(),
    campaignGroupId: z.unknown().optional(),
    action_type: z.unknown().optional(),
    actionType: z.unknown().optional(),
    title: z.unknown().optional(),
    summary: z.unknown().optional(),
    status: z.unknown().optional(),
    target: z.unknown().optional(),
    requested_change: z.unknown().optional(),
    requestedChange: z.unknown().optional(),
    before_state: z.unknown().optional(),
    beforeState: z.unknown().optional(),
    expected_after_state: z.unknown().optional(),
    expectedAfterState: z.unknown().optional(),
    applied_after_state: z.unknown().optional(),
    appliedAfterState: z.unknown().optional(),
    evidence_packet_id: z.unknown().optional(),
    evidencePacketId: z.unknown().optional(),
    risk_level: z.unknown().optional(),
    riskLevel: z.unknown().optional(),
    risk_reasons: z.unknown().optional(),
    riskReasons: z.unknown().optional(),
    requires_strong_confirmation: z.unknown().optional(),
    requiresStrongConfirmation: z.unknown().optional(),
    idempotency_key: z.unknown().optional(),
    idempotencyKey: z.unknown().optional(),
    approval_note: z.unknown().optional(),
    approvalNote: z.unknown().optional(),
    rejection_reason: z.unknown().optional(),
    rejectionReason: z.unknown().optional(),
    approved_at: z.unknown().optional(),
    approvedAt: z.unknown().optional(),
    rejected_at: z.unknown().optional(),
    rejectedAt: z.unknown().optional(),
    applying_at: z.unknown().optional(),
    applyingAt: z.unknown().optional(),
    applied_at: z.unknown().optional(),
    appliedAt: z.unknown().optional(),
    failed_at: z.unknown().optional(),
    failedAt: z.unknown().optional(),
    expires_at: z.unknown().optional(),
    expiresAt: z.unknown().optional(),
    created_at: z.unknown().optional(),
    createdAt: z.unknown().optional(),
    platform_response: z.unknown().optional(),
    platformResponse: z.unknown().optional(),
    error_details: z.unknown().optional(),
    errorDetails: z.unknown().optional(),
    rollback_guidance: z.unknown().optional(),
    rollbackGuidance: z.unknown().optional(),
  })
  .passthrough();

/**
 * Map a single server response row to the normalized proposal shape.
 * Handles both snake_case and camelCase field variants because the MCP
 * backend is still in active development.
 */
export function adaptProposal(raw: unknown): ControlCentreProposal {
  // Parse loosely to tolerate extra fields
  const parsed = rawServerRow.safeParse(raw);
  const src = parsed.success ? parsed.data : ((raw as Record<string, unknown>) ?? {});

  // snake_case → camelCase fallback accessor
  const field = <T>(camel: string, snake: string, fallback: T): T => {
    const v = (src as Record<string, unknown>)[camel] ?? (src as Record<string, unknown>)[snake];
    return (v === undefined || v === null ? fallback : v) as T;
  };

  const normalized = {
    id: String(field("id", "id", "")),
    campaignGroupId: String(field("campaignGroupId", "campaign_group_id", "unknown-cg")),

    actionType: String(field("actionType", "action_type", "unknown")),
    title: String(field("title", "title", "Untitled proposal")),
    summary: field<string | null>("summary", "summary", null),

    status: String(field("status", "status", "draft")),

    target: coerceRecord(field("target", "target", null)),

    requestedChange: coerceRecord(field("requestedChange", "requested_change", null)),

    beforeState: coerceRecord(field("beforeState", "before_state", null)),

    expectedAfterState: coerceRecord(field("expectedAfterState", "expected_after_state", null)),

    appliedAfterState: coerceRecord(field("appliedAfterState", "applied_after_state", null)),

    evidencePacketId: field<string | null>("evidencePacketId", "evidence_packet_id", null),

    riskLevel: String(field("riskLevel", "risk_level", "low")),
    riskReasons: coerceStringArray(field("riskReasons", "risk_reasons", [])),
    requiresStrongConfirmation: Boolean(
      field("requiresStrongConfirmation", "requires_strong_confirmation", false),
    ),

    idempotencyKey: field<string | undefined>("idempotencyKey", "idempotency_key", undefined),

    approvalNote: field<string | null>("approvalNote", "approval_note", null),
    rejectionReason: field<string | null>("rejectionReason", "rejection_reason", null),

    approvedAt: field<string | null>("approvedAt", "approved_at", null),
    rejectedAt: field<string | null>("rejectedAt", "rejected_at", null),
    applyingAt: field<string | null>("applyingAt", "applying_at", null),
    appliedAt: field<string | null>("appliedAt", "applied_at", null),
    failedAt: field<string | null>("failedAt", "failed_at", null),
    expiresAt: field<string | null>("expiresAt", "expires_at", null),
    createdAt: field<string | null>("createdAt", "created_at", null),

    platformResponse: coerceRecord(field("platformResponse", "platform_response", null)),
    errorDetails: coerceRecord(field("errorDetails", "error_details", null)),
    rollbackGuidance: coerceRecord(field("rollbackGuidance", "rollback_guidance", null)),
  };

  return controlCentreProposalSchema.parse(normalized);
}

/**
 * Adapt a list response. The server may return a raw array, an object with
 * a `data`/`proposals`/`rows` envelope, or the list directly.
 */
export function adaptProposalList(raw: unknown): ControlCentreProposal[] {
  if (Array.isArray(raw)) return raw.map(adaptProposal);

  const obj = raw as Record<string, unknown> | null;
  if (!obj) return [];

  // Common response envelope shapes
  const items = obj.data ?? obj.proposals ?? obj.rows ?? obj.items ?? obj.results;

  if (Array.isArray(items)) return items.map(adaptProposal);

  return [];
}

// ---------------------------------------------------------------------------
// Internal helpers — pure, no side effects, no DB writes
// ---------------------------------------------------------------------------

function coerceRecord(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function coerceStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}
