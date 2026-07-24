import { readBridge } from "@/renderer/bridge";
import { useConsultationStore } from "@/renderer/components/consultations/consultationStore";
import type { ConsultationSubmitResult } from "@/shared/contracts";

/**
 * Renderer consultation actions (Parts 6-8). Thin glue over the consultation
 * IPC: submit/panel/finalise/cancel/retry, initial load, and the live
 * `consultation-updated` subscription that feeds the Zustand store. Mention
 * parsing happens in the supervisor (the shared parser is the source of truth);
 * the renderer only forwards the raw message and renders structured errors.
 */

export interface ConsultationSubmitInput {
  projectId: string;
  parentThreadId: string;
  campaignGroupId: string;
  message: string;
}

function applyRecord(record: import("@/shared/consultations").ConsultationRecord): void {
  useConsultationStore.getState().setRecord(record);
}

const pendingContextPacketLoads = new Map<string, Promise<void>>();

function ensureLiveContextPacket(
  record: import("@/shared/consultations").ConsultationRecord,
): void {
  const packetId = record.contextPacketId;
  if (!packetId) return;
  const store = useConsultationStore.getState();
  if (store.contextPackets.has(packetId) || pendingContextPacketLoads.has(packetId)) return;

  const request = loadConsultationDetail(record.id)
    .catch((error) => {
      // The consultation record remains usable; a later event/reopen may retry.
      console.warn(`[consultations] failed to load context packet ${packetId}`, error);
    })
    .finally(() => {
      pendingContextPacketLoads.delete(packetId);
    });
  pendingContextPacketLoads.set(packetId, request);
}

/** Load every durable consultation (and its result) for a thread into the store. */
export async function loadConsultationsForThread(parentThreadId: string): Promise<void> {
  const { consultations, results, panelMembers, contextPackets } = await readBridge().consultationListForThread({
    parentThreadId,
  });
  const store = useConsultationStore.getState();
  store.replaceRecordsForThread(parentThreadId, consultations);
  for (const result of results) {
    store.setResult(result.consultationId, result);
  }
  for (const packet of contextPackets) {
    store.setContextPacket(packet);
  }
  store.setPanelMembers(panelMembers);
}

/** Submit a raw thread message; the supervisor parses the mention and routes it. */
export async function submitConsultation(input: ConsultationSubmitInput): Promise<ConsultationSubmitResult> {
  const result = await readBridge().consultationSubmit(input);
  if (result.ok) applyRecord(result.consultation);
  return result;
}

export async function submitPanelConsultation(
  input: ConsultationSubmitInput,
): Promise<ConsultationSubmitResult> {
  const result = await readBridge().consultationSubmitPanel(input);
  if (result.ok) applyRecord(result.consultation);
  return result;
}

export async function finaliseConsultations(
  input: ConsultationSubmitInput & { consultationIds?: string[] },
): Promise<ConsultationSubmitResult> {
  const result = await readBridge().consultationFinalise({
    projectId: input.projectId,
    parentThreadId: input.parentThreadId,
    campaignGroupId: input.campaignGroupId,
    message: input.message,
    ...(input.consultationIds ? { consultationIds: input.consultationIds } : {}),
  });
  if (result.ok) applyRecord(result.consultation);
  return result;
}

export async function cancelConsultation(id: string): Promise<void> {
  const { consultation } = await readBridge().consultationCancel({ id });
  if (consultation) applyRecord(consultation);
}

export async function retryConsultation(id: string): Promise<void> {
  const { consultation } = await readBridge().consultationRetry({ id });
  if (consultation) applyRecord(consultation);
}

/** Fetch the full result + context packet for one consultation (on demand). */
export async function loadConsultationDetail(id: string): Promise<void> {
  const { consultation, result, contextPacket } = await readBridge().consultationGet({ id });
  const store = useConsultationStore.getState();
  if (consultation) store.setRecord(consultation);
  if (result) store.setResult(id, result);
  if (contextPacket) store.setContextPacket(contextPacket);
}

/**
 * Subscribe to consultation lifecycle changes for the renderer. Returns an
 * unsubscribe function; call it when leaving the thread.
 */
export function subscribeToConsultationUpdates(): () => void {
  return readBridge().onSupervisorEvent((event) => {
    if (event.type !== "consultation-updated") return;
    const store = useConsultationStore.getState();
    store.setRecord(event.record);
    if (event.result) store.setResult(event.record.id, event.result);
    ensureLiveContextPacket(event.record);
  });
}
