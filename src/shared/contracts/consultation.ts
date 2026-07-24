import { z } from "zod";
import { CONSULTATION_ROLES } from "@/shared/consultations/types";
import type {
  ConsultationRecord,
  ConsultationResultRecord,
  ContextPacketRecord,
  PanelMembershipRecord,
} from "@/shared/consultations/types";

/**
 * Phase 4 consultation IPC contracts (Part 1). The renderer supplies ONLY
 * identifiers + raw user input; the trusted supervisor parses the mention,
 * resolves the provider/role/mode, validates the campaign-thread context and
 * drives the coordinator. The renderer can never supply a built context packet,
 * permissions, provider capabilities, child-thread ids or internal statuses.
 */

export const consultationSubmitPayloadSchema = z.object({
  projectId: z.string().min(1),
  parentThreadId: z.string().min(1),
  campaignGroupId: z.string().min(1),
  message: z.string().min(1),
});
export type ConsultationSubmitPayload = z.infer<typeof consultationSubmitPayloadSchema>;

const consultationPanelMemberSchema = z.object({
  role: z.enum(CONSULTATION_ROLES),
  requiredOrOptional: z.enum(["required", "optional"]).optional(),
  requestedProvider: z.string().min(1).optional(),
  requestedModel: z.string().min(1).optional(),
});
export type ConsultationPanelMemberInput = z.infer<typeof consultationPanelMemberSchema>;

export const consultationSubmitPanelPayloadSchema = z.object({
  projectId: z.string().min(1),
  parentThreadId: z.string().min(1),
  campaignGroupId: z.string().min(1),
  message: z.string().min(1),
  members: z.array(consultationPanelMemberSchema).min(2).optional(),
});
export type ConsultationSubmitPanelPayload = z.infer<typeof consultationSubmitPanelPayloadSchema>;

export const consultationFinalisePayloadSchema = z.object({
  projectId: z.string().min(1),
  parentThreadId: z.string().min(1),
  campaignGroupId: z.string().min(1),
  message: z.string().min(1),
  consultationIds: z.array(z.string().min(1)).optional(),
});
export type ConsultationFinalisePayload = z.infer<typeof consultationFinalisePayloadSchema>;

export const consultationCancelPayloadSchema = z.object({
  id: z.string().min(1),
});
export type ConsultationCancelPayload = z.infer<typeof consultationCancelPayloadSchema>;

export const consultationRetryPayloadSchema = z.object({
  id: z.string().min(1),
});
export type ConsultationRetryPayload = z.infer<typeof consultationRetryPayloadSchema>;

export const consultationListForThreadPayloadSchema = z.object({
  parentThreadId: z.string().min(1),
});
export type ConsultationListForThreadPayload = z.infer<
  typeof consultationListForThreadPayloadSchema
>;

export const consultationGetPayloadSchema = z.object({
  id: z.string().min(1),
});
export type ConsultationGetPayload = z.infer<typeof consultationGetPayloadSchema>;

export const consultationSubscribePayloadSchema = z.object({
  parentThreadId: z.string().min(1),
});
export type ConsultationSubscribePayload = z.infer<typeof consultationSubscribePayloadSchema>;

/**
 * Structured failure codes surfaced to the renderer from a synchronous submit
 * rejection. Async lifecycle failures (provider unavailable, context retrieval
 * failed, child launch failed, ...) are reported through the consultation
 * record's own `failureCode`/`safeFailureMessage` via the live-update event.
 */
export const CONSULTATION_SUBMIT_ERROR_CODES = [
  "unknown_mention",
  "missing_instruction",
  "ambiguous_mention",
  "unsupported_provider",
  "missing_campaign_group",
  "not_a_campaign_thread",
  "internal_error",
] as const;
export type ConsultationSubmitErrorCode = (typeof CONSULTATION_SUBMIT_ERROR_CODES)[number];

export type ConsultationSubmitResult =
  | { ok: true; consultation: ConsultationRecord }
  | { ok: false; code: ConsultationSubmitErrorCode; message: string; token: string | null };

export interface ConsultationCancelResult {
  consultation: ConsultationRecord | null;
}

export interface ConsultationRetryResult {
  consultation: ConsultationRecord | null;
}

export interface ConsultationListForThreadResult {
  consultations: ConsultationRecord[];
  results: ConsultationResultRecord[];
  panelMembers: PanelMembershipRecord[];
  contextPackets: ContextPacketRecord[];
}

export interface ConsultationGetResult {
  consultation: ConsultationRecord | null;
  result: ConsultationResultRecord | null;
  contextPacket: ContextPacketRecord | null;
}

export interface ConsultationSubscribeResult {
  consultations: ConsultationRecord[];
  results: ConsultationResultRecord[];
  panelMembers: PanelMembershipRecord[];
}
