import { z } from "zod";

/**
 * Wire schema for Control Centre's `list_campaign_groups` MCP tool response.
 * Production returns campaign groups with identity fields used to bind workspaces.
 */

export const controlCentreCampaignGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  clientName: z.string().nullable().optional(),
  jobNumber: z.string().nullable().optional(),
  status: z.string(),
});
export type ControlCentreCampaignGroup = z.infer<typeof controlCentreCampaignGroupSchema>;

const listEnvelopeSchema = z.union([
  z.array(controlCentreCampaignGroupSchema),
  z.object({ groups: z.array(controlCentreCampaignGroupSchema) }),
  z.object({ data: z.array(controlCentreCampaignGroupSchema) }),
]);

export function normalizeCampaignGroupList(raw: unknown): ControlCentreCampaignGroup[] {
  const parsed = listEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return [];
  const value = parsed.data;
  if (Array.isArray(value)) return value;
  if ("groups" in value) return value.groups;
  return value.data;
}

export const controlCentreCampaignGroupListSchema = z
  .unknown()
  .transform((raw) => normalizeCampaignGroupList(raw));
