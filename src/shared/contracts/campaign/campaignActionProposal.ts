import { z } from "zod";

/**
 * A proposed, reviewable action against a campaign entity.
 *
 * `CampaignActionProposal` captures a structured diff (before vs. proposed
 * state) targeting a specific platform entity. Every proposal cites the
 * `EvidencePacket` used to justify it and moves through a lifecycle:
 * `draft` → `awaiting_approval` → `approved|rejected` → `applied` (or
 * `failed`). High-risk proposals require explicit human approval before
 * they can be applied.
 */
export const campaignActionProposalSchema = z.object({
  id: z.string().min(1),
  campaignGroupId: z.string().min(1),
  actionType: z.string().min(1),
  targetPlatform: z.string().min(1),
  targetEntityType: z.string().min(1),
  targetEntityId: z.string().min(1),
  reason: z.string().min(1),
  beforeState: z.string().min(1),
  proposedState: z.string().min(1),
  evidencePacketId: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  status: z.enum(["draft", "awaiting_approval", "approved", "rejected", "applied", "failed"]),
  createdByAgent: z.string().min(1).optional(),
  approvedBy: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().optional(),
  appliedAt: z.string().datetime().optional(),
});

export type CampaignActionProposal = z.infer<typeof campaignActionProposalSchema>;
