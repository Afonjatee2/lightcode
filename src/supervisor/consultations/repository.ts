import type {
  ConsultationResultRecord,
  ConsultationRecord,
  ConsultationStatus,
  ContextPacketRecord,
  PanelMembershipRecord,
  ThreadSummaryRecord,
} from "@/shared/consultations";

/**
 * Persistence port the coordinator depends on. The production binding is
 * {@link SqliteConsultationRepository}; tests can supply the real SQLite-backed
 * one (temp DB) or a fake. Keeping this narrow means the coordinator never
 * touches better-sqlite3 directly.
 */
export interface ConsultationRepository {
  saveConsultation(record: ConsultationRecord): void;
  getConsultation(id: string): ConsultationRecord | null;
  listByParentThread(parentThreadId: string): ConsultationRecord[];
  listByCampaignGroup(campaignGroupId: string): ConsultationRecord[];
  listByStatuses(statuses: readonly ConsultationStatus[]): ConsultationRecord[];
  getByChildRun(childThreadOrRunId: string): ConsultationRecord | null;
  listRetriesOf(consultationId: string): ConsultationRecord[];

  saveContextPacket(record: ContextPacketRecord): void;
  getContextPacket(id: string): ContextPacketRecord | null;
  getContextPacketForConsultation(consultationId: string): ContextPacketRecord | null;

  saveThreadSummary(record: ThreadSummaryRecord): void;
  getLatestThreadSummary(threadId: string): ThreadSummaryRecord | null;

  saveResult(record: ConsultationResultRecord): void;
  getResult(id: string): ConsultationResultRecord | null;
  getResultForConsultation(consultationId: string): ConsultationResultRecord | null;

  savePanelMembership(record: PanelMembershipRecord): void;
  listPanelMembers(parentPanelConsultationId: string): PanelMembershipRecord[];
}
