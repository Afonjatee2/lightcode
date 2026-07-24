import { z } from "zod";

export const campaignDecisionSchema = z.object({
  id: z.string().min(1),
  campaignGroupId: z.string().min(1),
  scopeType: z.enum(["campaign", "channel", "platform_campaign", "alert"]),
  scopeId: z.string().min(1).optional(),
  statement: z.string().min(1),
  reason: z.string().optional(),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  sourceType: z.enum(["user", "email", "plan", "meeting", "system"]),
  sourceReferenceId: z.string().min(1).optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type CampaignDecision = z.infer<typeof campaignDecisionSchema>;
