import {
  dbGetConsultation,
  dbGetConsultationByChildRun,
  dbGetConsultationResult,
  dbGetConsultationResultForConsultation,
  dbGetContextPacket,
  dbGetContextPacketForConsultation,
  dbGetLatestThreadSummary,
  dbInsertConsultationResult,
  dbInsertContextPacket,
  dbInsertPanelMembership,
  dbInsertThreadSummary,
  dbListConsultationsByCampaignGroup,
  dbListConsultationsByParentThread,
  dbListConsultationsByStatuses,
  dbListPanelMembers,
  dbListRetriesOf,
  dbUpsertConsultation,
} from "@/main/db/consultations";
import type { ConsultationRepository } from "./repository";

/**
 * Production {@link ConsultationRepository} binding backed by the main-process
 * SQLite layer (the same `state.sqlite` every other durable feature uses).
 */
export class SqliteConsultationRepository implements ConsultationRepository {
  saveConsultation = dbUpsertConsultation;
  getConsultation = dbGetConsultation;
  listByParentThread = dbListConsultationsByParentThread;
  listByCampaignGroup = dbListConsultationsByCampaignGroup;
  listByStatuses = dbListConsultationsByStatuses;
  getByChildRun = dbGetConsultationByChildRun;
  listRetriesOf = dbListRetriesOf;

  saveContextPacket = dbInsertContextPacket;
  getContextPacket = dbGetContextPacket;
  getContextPacketForConsultation = dbGetContextPacketForConsultation;

  saveThreadSummary = dbInsertThreadSummary;
  getLatestThreadSummary = dbGetLatestThreadSummary;

  saveResult = dbInsertConsultationResult;
  getResult = dbGetConsultationResult;
  getResultForConsultation = dbGetConsultationResultForConsultation;

  savePanelMembership = dbInsertPanelMembership;
  listPanelMembers = dbListPanelMembers;
}
