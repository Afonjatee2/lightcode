import { create } from "zustand";
import type {
  ConsultationRecord,
  ConsultationResultAttachment,
  ConsultationResultRecord,
  ConsultationStatus,
  ContextPacketRecord,
  PanelMembershipRecord,
} from "@/shared/consultations";
import { buildResultAttachment } from "@/shared/consultations";

interface ConsultationStore {
  records: Map<string, ConsultationRecord>;
  results: Map<string, ConsultationResultRecord>;
  contextPackets: Map<string, ContextPacketRecord>;
  panelMembers: Map<string, PanelMembershipRecord[]>;
  setRecord: (record: ConsultationRecord) => void;
  setRecords: (records: ConsultationRecord[]) => void;
  /** Replace only the records belonging to one thread, preserving others. */
  replaceRecordsForThread: (threadId: string, records: ConsultationRecord[]) => void;
  setResult: (consultationId: string, result: ConsultationResultRecord) => void;
  setContextPacket: (packet: ContextPacketRecord) => void;
  setPanelMembers: (members: PanelMembershipRecord[]) => void;
  removeRecord: (id: string) => void;
  getRecordsForThread: (threadId: string) => ConsultationRecord[];
  getPanelMembers: (panelConsultationId: string) => PanelMembershipRecord[];
  getAttachment: (id: string) => ConsultationResultAttachment | null;
  clear: () => void;
}

export const useConsultationStore = create<ConsultationStore>()((set, get) => ({
  records: new Map(),
  results: new Map(),
  contextPackets: new Map(),
  panelMembers: new Map(),

  setRecord: (record) =>
    set((state) => {
      const next = new Map(state.records);
      next.set(record.id, record);
      return { records: next };
    }),

  setRecords: (records) =>
    set(() => {
      const next = new Map<string, ConsultationRecord>();
      for (const record of records) {
        next.set(record.id, record);
      }
      return { records: next };
    }),

  replaceRecordsForThread: (threadId, records) =>
    set((state) => {
      const next = new Map(state.records);
      // Remove stale records for this thread.
      for (const [id, record] of next) {
        if (record.parentThreadId === threadId) next.delete(id);
      }
      // Add new records.
      for (const record of records) {
        next.set(record.id, record);
      }
      return { records: next };
    }),

  setResult: (consultationId, result) =>
    set((state) => {
      const next = new Map(state.results);
      next.set(consultationId, result);
      return { results: next };
    }),

  setContextPacket: (packet) =>
    set((state) => {
      const next = new Map(state.contextPackets);
      next.set(packet.id, packet);
      return { contextPackets: next };
    }),

  setPanelMembers: (members) =>
    set((state) => {
      const next = new Map(state.panelMembers);
      for (const member of members) {
        const list = next.get(member.parentPanelConsultationId) ?? [];
        if (!list.some((existing) => existing.childConsultationId === member.childConsultationId)) {
          list.push(member);
        }
        next.set(member.parentPanelConsultationId, list);
      }
      return { panelMembers: next };
    }),

  removeRecord: (id) =>
    set((state) => {
      const next = new Map(state.records);
      next.delete(id);
      return { records: next };
    }),

  getRecordsForThread: (threadId) => {
    const records: ConsultationRecord[] = [];
    for (const record of get().records.values()) {
      if (record.parentThreadId === threadId) {
        records.push(record);
      }
    }
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return records;
  },

  getPanelMembers: (panelConsultationId) => get().panelMembers.get(panelConsultationId) ?? [],

  getAttachment: (id) => {
    const record = get().records.get(id);
    if (!record) return null;
    const result = get().results.get(id);
    return buildResultAttachment(record, result ?? null);
  },

  clear: () => set({ records: new Map(), results: new Map(), contextPackets: new Map(), panelMembers: new Map() }),
}));

export function statusLabel(status: ConsultationStatus): string {
  const labels: Record<ConsultationStatus, string> = {
    queued: "Queued",
    building_context: "Building context",
    ready: "Ready",
    running: "Running",
    awaiting_input: "Awaiting input",
    completed: "Completed",
    failed: "Failed",
    cancel_requested: "Cancelling",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

export function statusVariant(status: ConsultationStatus): "default" | "warning" | "success" | "danger" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "danger";
    case "cancel_requested":
    case "awaiting_input":
      return "warning";
    default:
      return "default";
  }
}
