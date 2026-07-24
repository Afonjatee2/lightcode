import {
  consultationCancelPayloadSchema,
  consultationFinalisePayloadSchema,
  consultationGetPayloadSchema,
  consultationListForThreadPayloadSchema,
  consultationRetryPayloadSchema,
  consultationSubmitPanelPayloadSchema,
  consultationSubmitPayloadSchema,
  consultationSubscribePayloadSchema,
} from "../../contracts";
import type {
  ConsultationCancelPayload,
  ConsultationCancelResult,
  ConsultationFinalisePayload,
  ConsultationGetPayload,
  ConsultationGetResult,
  ConsultationListForThreadPayload,
  ConsultationListForThreadResult,
  ConsultationRetryPayload,
  ConsultationRetryResult,
  ConsultationSubmitPanelPayload,
  ConsultationSubmitPayload,
  ConsultationSubmitResult,
  ConsultationSubscribePayload,
  ConsultationSubscribeResult,
} from "../../contracts";
import { definePayloadProcedure } from "../core";

/**
 * Phase 4 consultation procedures (Part 1). All are supervisor-backed; payload
 * validation is enforced by the zod schemas before the request reaches the
 * supervisor. Live lifecycle updates flow through the `consultation-updated`
 * SupervisorEvent (see events.ts), not a long-lived RPC.
 */
export const consultationProcedures = {
  consultationSubmit: definePayloadProcedure<ConsultationSubmitPayload, ConsultationSubmitResult, "supervisor">(
    "consultationSubmit",
    "supervisor",
    consultationSubmitPayloadSchema,
  ),
  consultationSubmitPanel: definePayloadProcedure<
    ConsultationSubmitPanelPayload,
    ConsultationSubmitResult,
    "supervisor"
  >("consultationSubmitPanel", "supervisor", consultationSubmitPanelPayloadSchema),
  consultationFinalise: definePayloadProcedure<
    ConsultationFinalisePayload,
    ConsultationSubmitResult,
    "supervisor"
  >("consultationFinalise", "supervisor", consultationFinalisePayloadSchema),
  consultationCancel: definePayloadProcedure<ConsultationCancelPayload, ConsultationCancelResult, "supervisor">(
    "consultationCancel",
    "supervisor",
    consultationCancelPayloadSchema,
  ),
  consultationRetry: definePayloadProcedure<ConsultationRetryPayload, ConsultationRetryResult, "supervisor">(
    "consultationRetry",
    "supervisor",
    consultationRetryPayloadSchema,
  ),
  consultationListForThread: definePayloadProcedure<
    ConsultationListForThreadPayload,
    ConsultationListForThreadResult,
    "supervisor"
  >("consultationListForThread", "supervisor", consultationListForThreadPayloadSchema),
  consultationGet: definePayloadProcedure<ConsultationGetPayload, ConsultationGetResult, "supervisor">(
    "consultationGet",
    "supervisor",
    consultationGetPayloadSchema,
  ),
  consultationSubscribe: definePayloadProcedure<
    ConsultationSubscribePayload,
    ConsultationSubscribeResult,
    "supervisor"
  >("consultationSubscribe", "supervisor", consultationSubscribePayloadSchema),
} as const;
