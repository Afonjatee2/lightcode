import type { ConsultationRecord } from "@/shared/consultations";
import type { ConsultationRepository } from "@/supervisor/consultations/repository";
import { SqliteConsultationRepository } from "@/supervisor/consultations/sqliteRepository";

/**
 * SQLite-backed consultation store. This REPLACES the earlier in-memory Map
 * store, which was ephemeral and did not survive a supervisor restart. Every
 * read/write now goes through the durable {@link ConsultationRepository}
 * (state.sqlite), so consultations persist across restarts and can be
 * reconciled on startup (Part 13). The file path is preserved; the type moves
 * from the narrow legacy AgentConsultation to the full ConsultationRecord.
 */
export interface ConsultationStoreDeps {
  /** Defaults to the main-process SQLite binding. */
  repository?: ConsultationRepository;
  /** Emit consultation lifecycle changes (for UI integration). */
  onChanged?: (consultation: ConsultationRecord) => void;
}

export class ConsultationStore {
  private readonly repository: ConsultationRepository;

  constructor(private readonly deps: ConsultationStoreDeps = {}) {
    this.repository = deps.repository ?? new SqliteConsultationRepository();
  }

  insert(consultation: ConsultationRecord): void {
    this.repository.saveConsultation(consultation);
    this.deps.onChanged?.(consultation);
  }

  update(consultation: ConsultationRecord): void {
    this.repository.saveConsultation(consultation);
    this.deps.onChanged?.(consultation);
  }

  get(id: string): ConsultationRecord | null {
    return this.repository.getConsultation(id);
  }

  getByChildThreadId(childThreadId: string): ConsultationRecord | null {
    return this.repository.getByChildRun(childThreadId);
  }

  listByParentThread(parentThreadId: string): ConsultationRecord[] {
    return this.repository.listByParentThread(parentThreadId);
  }

  listByCampaignGroup(campaignGroupId: string): ConsultationRecord[] {
    return this.repository.listByCampaignGroup(campaignGroupId);
  }

  /** The underlying durable repository (shared with the coordinator). */
  getRepository(): ConsultationRepository {
    return this.repository;
  }
}
