import { z } from "zod";

import { campaignContextSchema, evidenceClaimSchema } from "./campaignContext";

/**
 * Context packet assembled for an agent consultation.
 * Contains the focused evidence and messages the consulted agent needs —
 * never the full thread history. Built by the @agent mention router.
 *
 * Phase 3: campaignContext and evidence are now typed (replaces z.unknown()
 * placeholders). The Control Centre `get_campaign_context` MCP tool returns
 * a CampaignContext; the router slices it into this packet.
 */
export const consultationContextPacketSchema = z.object({
  /** The user's question or instruction that triggered the consultation. */
  userQuestion: z.string().min(1),
  /** The consultation mode requested via @agent command. */
  requestedMode: z.enum(["review", "verify", "challenge", "research", "panel"]),
  /** The parent thread's most recent assistant response (for context). */
  parentResponse: z.string().optional(),
  /** Selected messages from the parent thread relevant to the question. */
  selectedMessages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system", "tool"]),
      content: z.string().min(1),
    }),
  ),
  /** Campaign context snapshot from Control Centre (get_campaign_context). */
  campaignContext: campaignContextSchema.optional(),
  /** Evidence claims from CC (deterministic calculations, source references). */
  evidence: z.array(evidenceClaimSchema).optional(),
  /** Active campaign decisions that affect interpretation. */
  activeDecisions: z.array(z.unknown()).optional(),
  /** Relevant plan facts (budget, dates, channels). */
  planFacts: z.array(z.unknown()).optional(),
  /** Open alerts relevant to the question. */
  alerts: z.array(z.unknown()).optional(),
  /** Date range the consultation covers. */
  dateRange: z.object({ from: z.string(), to: z.string() }).optional(),
});

export type ConsultationContextPacket = z.infer<typeof consultationContextPacketSchema>;
export type ConsultationMode = ConsultationContextPacket["requestedMode"];
