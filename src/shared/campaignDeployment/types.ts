import { z } from "zod";

/**
 * Deployment-client proposal shape. Overlapping fields (`id`, `campaignGroupId`,
 * `actionType`, `riskLevel`, `status`, evidence reference) align with the
 * authoritative `CampaignActionProposal` contract in
 * `src/shared/contracts/campaign/campaignActionProposal.ts`. This module adds
 * server-normalised state blobs and extended lifecycle values the MCP adapter
 * tolerates from Control Centre.
 */

// ---------------------------------------------------------------------------
// Proposal status — mirrors Control Centre proposal-state-machine
// ---------------------------------------------------------------------------
export const PROPOSAL_STATUS = [
  "draft",
  "awaiting_approval",
  "approved",
  "rejected",
  "applying",
  "applied",
  "failed",
  "cancelled",
  "expired",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

export const proposalStatusSchema = z.enum(PROPOSAL_STATUS);

// ---------------------------------------------------------------------------
// Risk level
// ---------------------------------------------------------------------------
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const riskLevelSchema = z.enum(RISK_LEVELS);

// ---------------------------------------------------------------------------
// Target entity reference
// ---------------------------------------------------------------------------
export const targetEntitySchema = z
  .object({
    platform: z.string().optional(),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    campaignId: z.string().optional(),
    accountId: z.string().optional(),
  })
  .passthrough();

export type TargetEntity = z.infer<typeof targetEntitySchema>;

// ---------------------------------------------------------------------------
// Normalized Control Centre proposal response
//
// Tolerates the dirty Phase 6 contract: some fields may be missing or
// differently shaped. This is the canonical shape Poracode uses after
// adapter normalisation.
// ---------------------------------------------------------------------------
export const controlCentreProposalSchema = z.object({
  id: z.string().min(1),
  campaignGroupId: z.string().min(1),

  actionType: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullable().default(null),

  status: proposalStatusSchema,

  target: targetEntitySchema.nullable().default(null),

  /** The requested change — this is the "proposed state" from the client POV */
  requestedChange: z.record(z.string(), z.unknown()).nullable().default(null),

  /** Snapshot of state before the change (server-side) */
  beforeState: z.record(z.string(), z.unknown()).nullable().default(null),

  /** Server-predicted state after the change */
  expectedAfterState: z.record(z.string(), z.unknown()).nullable().default(null),

  /** Actual state after the change was applied (server-side only) */
  appliedAfterState: z.record(z.string(), z.unknown()).nullable().default(null),

  evidencePacketId: z.string().uuid().nullable().default(null),

  riskLevel: riskLevelSchema,
  riskReasons: z.array(z.string()).default([]),
  requiresStrongConfirmation: z.boolean().default(false),

  idempotencyKey: z.string().optional(),

  approvalNote: z.string().nullable().default(null),
  rejectionReason: z.string().nullable().default(null),

  approvedAt: z.string().datetime().nullable().default(null),
  rejectedAt: z.string().datetime().nullable().default(null),
  applyingAt: z.string().datetime().nullable().default(null),
  appliedAt: z.string().datetime().nullable().default(null),
  failedAt: z.string().datetime().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime().nullable().default(null),

  platformResponse: z.record(z.string(), z.unknown()).nullable().default(null),
  errorDetails: z.record(z.string(), z.unknown()).nullable().default(null),
  rollbackGuidance: z.record(z.string(), z.unknown()).nullable().default(null),
});

export type ControlCentreProposal = z.infer<typeof controlCentreProposalSchema>;

// ---------------------------------------------------------------------------
// List request/filter
// ---------------------------------------------------------------------------
export const listProposalsFilterSchema = z.object({
  campaignGroupId: z.string().min(1),
  status: proposalStatusSchema.optional(),
});

export type ListProposalsFilter = z.infer<typeof listProposalsFilterSchema>;

// ---------------------------------------------------------------------------
// Approval / rejection payloads
// ---------------------------------------------------------------------------
export const approvePayloadSchema = z.object({
  id: z.string().min(1),
  approvalNote: z.string().optional(),
  strongConfirmation: z.string().optional(),
});

export type ApprovePayload = z.infer<typeof approvePayloadSchema>;

export const rejectPayloadSchema = z.object({
  id: z.string().min(1),
  rejectionReason: z.string().min(1).optional(),
});

export type RejectPayload = z.infer<typeof rejectPayloadSchema>;

// ---------------------------------------------------------------------------
// Deployment profile policy descriptor
// ---------------------------------------------------------------------------
export const DEPLOYMENT_PROFILE_ID = "deployment" as const;

export interface DeploymentPolicy {
  /** Human-readable label */
  label: string;
  /** Description shown to operators */
  description: string;
  /** Tool names (or prefixes) explicitly allowed */
  allowedToolPatterns: string[];
  /** Tool names (or prefixes) explicitly denied */
  deniedToolPatterns: string[];
  /** Tools that require operator approval before execution */
  approvalRequiredPatterns: string[];
  /** Whether this profile allows direct platform writes */
  allowsDirectPlatformWrite: boolean;
}

// ---------------------------------------------------------------------------
// Client interface: operations Poracode may call against Control Centre
// ---------------------------------------------------------------------------
export interface ControlCentreDeploymentClient {
  /** List proposals for a campaign group (optionally filtered by status) */
  listProposals(filter: ListProposalsFilter): Promise<ControlCentreProposal[]>;

  /** Get a single proposal by ID */
  getProposal(id: string): Promise<ControlCentreProposal>;

  /** Refresh (re-fetch) a single proposal to check server-updated status */
  refreshProposal(id: string): Promise<ControlCentreProposal>;

  /** Approve a pending proposal. Forwards optional note + strong confirmation. */
  approveProposal(payload: ApprovePayload): Promise<ControlCentreProposal>;

  /** Reject a pending proposal with optional reason. */
  rejectProposal(payload: RejectPayload): Promise<ControlCentreProposal>;
}
