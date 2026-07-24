import { z } from "zod";

export const campaignWorkspaceProjectSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  campaignGroupId: z.string().min(1),
  clientName: z.string().min(1),
  campaignName: z.string().min(1),
  jobNumber: z.string().min(1).optional(),
  defaultAgentKind: z.string().min(1).optional(),
  mcpProfileId: z.string().min(1).optional(),
  archivedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().nonnegative(),
});
export type CampaignWorkspaceProject = z.infer<typeof campaignWorkspaceProjectSchema>;
