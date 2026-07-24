import { z } from "zod";

export const evidencePacketSchema = z.object({
  id: z.string().trim().min(1),
  campaignGroupId: z.string().trim().min(1),
  question: z.string().trim().min(1),
  dateRange: z.object({ from: z.string(), to: z.string() }).optional(),
  generatedAt: z.string().datetime({ offset: true }),
  sourceFreshness: z.string(),
  calculations: z.array(z.unknown()),
  alerts: z.array(z.unknown()),
  planFacts: z.array(z.unknown()),
  campaignEvents: z.array(z.unknown()),
  externalSources: z.string().optional(),
});
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;
