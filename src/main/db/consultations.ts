import type {
  ConsultationResultRecord,
  ConsultationRecord,
  ContextPacketRecord,
  PanelMembershipRecord,
  ThreadSummaryRecord,
} from "@/shared/consultations";
import { getSqlite } from "./connection";

/**
 * Durable persistence for Phase 4 campaign consultations. Raw better-sqlite3
 * prepared statements (the schedules/scheduleRuns pattern). This replaces the
 * earlier in-memory ConsultationStore: every record survives a supervisor
 * restart so the coordinator can reconcile queued/running work on startup.
 */

interface ConsultationRow {
  id: string;
  parent_project_id: string;
  parent_thread_id: string;
  campaign_group_id: string;
  child_thread_or_run_id: string | null;
  original_mention: string;
  original_instruction: string;
  resolved_role: string;
  requested_provider: string | null;
  actual_provider: string | null;
  requested_model: string | null;
  actual_model: string | null;
  consultation_mode: string;
  status: string;
  context_packet_id: string | null;
  permission_policy_version: string;
  actor: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  failure_code: string | null;
  safe_failure_message: string | null;
  result_summary_id: string | null;
  retry_of_consultation_id: string | null;
  panel_completion_rule: string | null;
}

function consultationFromRow(row: ConsultationRow): ConsultationRecord {
  return {
    id: row.id,
    parentProjectId: row.parent_project_id,
    parentThreadId: row.parent_thread_id,
    campaignGroupId: row.campaign_group_id,
    childThreadOrRunId: row.child_thread_or_run_id,
    originalMention: row.original_mention,
    originalInstruction: row.original_instruction,
    resolvedRole: row.resolved_role as ConsultationRecord["resolvedRole"],
    requestedProvider: row.requested_provider,
    actualProvider: row.actual_provider,
    requestedModel: row.requested_model,
    actualModel: row.actual_model,
    consultationMode: row.consultation_mode as ConsultationRecord["consultationMode"],
    status: row.status as ConsultationRecord["status"],
    contextPacketId: row.context_packet_id,
    permissionPolicyVersion: row.permission_policy_version,
    actor: row.actor,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    failureCode: row.failure_code as ConsultationRecord["failureCode"],
    safeFailureMessage: row.safe_failure_message,
    resultSummaryId: row.result_summary_id,
    retryOfConsultationId: row.retry_of_consultation_id,
    panelCompletionRule: row.panel_completion_rule ? JSON.parse(row.panel_completion_rule) : null,
  };
}

const CONSULTATION_COLUMNS = `
  id, parent_project_id, parent_thread_id, campaign_group_id, child_thread_or_run_id,
  original_mention, original_instruction, resolved_role, requested_provider, actual_provider,
  requested_model, actual_model, consultation_mode, status, context_packet_id,
  permission_policy_version, actor, created_at, started_at, completed_at, cancelled_at,
  failure_code, safe_failure_message, result_summary_id, retry_of_consultation_id,
  panel_completion_rule
`;

function consultationValues(record: ConsultationRecord): unknown[] {
  return [
    record.id,
    record.parentProjectId,
    record.parentThreadId,
    record.campaignGroupId,
    record.childThreadOrRunId,
    record.originalMention,
    record.originalInstruction,
    record.resolvedRole,
    record.requestedProvider,
    record.actualProvider,
    record.requestedModel,
    record.actualModel,
    record.consultationMode,
    record.status,
    record.contextPacketId,
    record.permissionPolicyVersion,
    record.actor,
    record.createdAt,
    record.startedAt,
    record.completedAt,
    record.cancelledAt,
    record.failureCode,
    record.safeFailureMessage,
    record.resultSummaryId,
    record.retryOfConsultationId,
    record.panelCompletionRule ? JSON.stringify(record.panelCompletionRule) : null,
  ];
}

/** Insert or fully replace a consultation row (the coordinator owns the record). */
export function dbUpsertConsultation(record: ConsultationRecord): void {
  getSqlite()
    .prepare(
      `INSERT INTO consultations (${CONSULTATION_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         parent_project_id = excluded.parent_project_id,
         parent_thread_id = excluded.parent_thread_id,
         campaign_group_id = excluded.campaign_group_id,
         child_thread_or_run_id = excluded.child_thread_or_run_id,
         original_mention = excluded.original_mention,
         original_instruction = excluded.original_instruction,
         resolved_role = excluded.resolved_role,
         requested_provider = excluded.requested_provider,
         actual_provider = excluded.actual_provider,
         requested_model = excluded.requested_model,
         actual_model = excluded.actual_model,
         consultation_mode = excluded.consultation_mode,
         status = excluded.status,
         context_packet_id = excluded.context_packet_id,
         permission_policy_version = excluded.permission_policy_version,
         actor = excluded.actor,
         created_at = excluded.created_at,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         cancelled_at = excluded.cancelled_at,
         failure_code = excluded.failure_code,
         safe_failure_message = excluded.safe_failure_message,
         result_summary_id = excluded.result_summary_id,
         retry_of_consultation_id = excluded.retry_of_consultation_id,
         panel_completion_rule = excluded.panel_completion_rule`,
    )
    .run(...consultationValues(record));
}

export function dbGetConsultation(id: string): ConsultationRecord | null {
  const row = getSqlite().prepare("SELECT * FROM consultations WHERE id = ?").get(id) as
    | ConsultationRow
    | undefined;
  return row ? consultationFromRow(row) : null;
}

export function dbListConsultationsByParentThread(parentThreadId: string): ConsultationRecord[] {
  const rows = getSqlite()
    .prepare(
      "SELECT * FROM consultations WHERE parent_thread_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .all(parentThreadId) as ConsultationRow[];
  return rows.map(consultationFromRow);
}

export function dbListConsultationsByCampaignGroup(campaignGroupId: string): ConsultationRecord[] {
  const rows = getSqlite()
    .prepare(
      "SELECT * FROM consultations WHERE campaign_group_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .all(campaignGroupId) as ConsultationRow[];
  return rows.map(consultationFromRow);
}

export function dbListConsultationsByStatuses(statuses: readonly string[]): ConsultationRecord[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = getSqlite()
    .prepare(
      `SELECT * FROM consultations WHERE status IN (${placeholders}) ORDER BY created_at ASC, rowid ASC`,
    )
    .all(...statuses) as ConsultationRow[];
  return rows.map(consultationFromRow);
}

export function dbGetConsultationByChildRun(childThreadOrRunId: string): ConsultationRecord | null {
  const row = getSqlite()
    .prepare("SELECT * FROM consultations WHERE child_thread_or_run_id = ? LIMIT 1")
    .get(childThreadOrRunId) as ConsultationRow | undefined;
  return row ? consultationFromRow(row) : null;
}

export function dbListRetriesOf(consultationId: string): ConsultationRecord[] {
  const rows = getSqlite()
    .prepare(
      "SELECT * FROM consultations WHERE retry_of_consultation_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(consultationId) as ConsultationRow[];
  return rows.map(consultationFromRow);
}

interface ContextPacketRow {
  id: string;
  consultation_id: string;
  structured_context: string;
  content_hash: string;
  contract_version: string;
  redaction_metadata: string;
  evidence_freshness: string;
  missing_data_warnings: string;
  created_at: string;
}

function contextPacketFromRow(row: ContextPacketRow): ContextPacketRecord {
  return {
    id: row.id,
    consultationId: row.consultation_id,
    structuredContext: JSON.parse(row.structured_context),
    contentHash: row.content_hash,
    contractVersion: row.contract_version,
    redactionMetadata: JSON.parse(row.redaction_metadata),
    evidenceFreshness: JSON.parse(row.evidence_freshness),
    missingDataWarnings: JSON.parse(row.missing_data_warnings),
    createdAt: row.created_at,
  };
}

export function dbInsertContextPacket(record: ContextPacketRecord): void {
  getSqlite()
    .prepare(
      `INSERT INTO context_packets (
        id, consultation_id, structured_context, content_hash, contract_version,
        redaction_metadata, evidence_freshness, missing_data_warnings, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         consultation_id = excluded.consultation_id,
         structured_context = excluded.structured_context,
         content_hash = excluded.content_hash,
         contract_version = excluded.contract_version,
         redaction_metadata = excluded.redaction_metadata,
         evidence_freshness = excluded.evidence_freshness,
         missing_data_warnings = excluded.missing_data_warnings,
         created_at = excluded.created_at`,
    )
    .run(
      record.id,
      record.consultationId,
      JSON.stringify(record.structuredContext),
      record.contentHash,
      record.contractVersion,
      JSON.stringify(record.redactionMetadata),
      JSON.stringify(record.evidenceFreshness),
      JSON.stringify(record.missingDataWarnings),
      record.createdAt,
    );
}

export function dbGetContextPacket(id: string): ContextPacketRecord | null {
  const row = getSqlite().prepare("SELECT * FROM context_packets WHERE id = ?").get(id) as
    | ContextPacketRow
    | undefined;
  return row ? contextPacketFromRow(row) : null;
}

export function dbGetContextPacketForConsultation(
  consultationId: string,
): ContextPacketRecord | null {
  const row = getSqlite()
    .prepare(
      "SELECT * FROM context_packets WHERE consultation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(consultationId) as ContextPacketRow | undefined;
  return row ? contextPacketFromRow(row) : null;
}

interface ThreadSummaryRow {
  id: string;
  thread_id: string;
  summary: string;
  source_cursor: string;
  provider: string;
  model: string;
  content_hash: string;
  created_at: string;
}

function threadSummaryFromRow(row: ThreadSummaryRow): ThreadSummaryRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    summary: row.summary,
    sourceCursor: row.source_cursor,
    provider: row.provider,
    model: row.model,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

export function dbInsertThreadSummary(record: ThreadSummaryRecord): void {
  getSqlite()
    .prepare(
      `INSERT INTO thread_summaries (
        id, thread_id, summary, source_cursor, provider, model, content_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         thread_id = excluded.thread_id,
         summary = excluded.summary,
         source_cursor = excluded.source_cursor,
         provider = excluded.provider,
         model = excluded.model,
         content_hash = excluded.content_hash,
         created_at = excluded.created_at`,
    )
    .run(
      record.id,
      record.threadId,
      record.summary,
      record.sourceCursor,
      record.provider,
      record.model,
      record.contentHash,
      record.createdAt,
    );
}

export function dbGetLatestThreadSummary(threadId: string): ThreadSummaryRecord | null {
  const row = getSqlite()
    .prepare(
      "SELECT * FROM thread_summaries WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(threadId) as ThreadSummaryRow | undefined;
  return row ? threadSummaryFromRow(row) : null;
}

interface ConsultationResultRow {
  id: string;
  consultation_id: string;
  summary: string;
  key_findings: string;
  evidence_references: string;
  assumptions: string;
  uncertainties: string;
  recommended_actions: string;
  suggested_proposal_inputs: string;
  generated_file_references: string;
  completed_at: string;
}

function consultationResultFromRow(row: ConsultationResultRow): ConsultationResultRecord {
  return {
    id: row.id,
    consultationId: row.consultation_id,
    summary: row.summary,
    keyFindings: JSON.parse(row.key_findings),
    evidenceReferences: JSON.parse(row.evidence_references),
    assumptions: JSON.parse(row.assumptions),
    uncertainties: JSON.parse(row.uncertainties),
    recommendedActions: JSON.parse(row.recommended_actions),
    suggestedProposalInputs: JSON.parse(row.suggested_proposal_inputs),
    generatedFileReferences: JSON.parse(row.generated_file_references),
    completedAt: row.completed_at,
  };
}

export function dbInsertConsultationResult(record: ConsultationResultRecord): void {
  getSqlite()
    .prepare(
      `INSERT INTO consultation_results (
        id, consultation_id, summary, key_findings, evidence_references, assumptions,
        uncertainties, recommended_actions, suggested_proposal_inputs,
        generated_file_references, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         consultation_id = excluded.consultation_id,
         summary = excluded.summary,
         key_findings = excluded.key_findings,
         evidence_references = excluded.evidence_references,
         assumptions = excluded.assumptions,
         uncertainties = excluded.uncertainties,
         recommended_actions = excluded.recommended_actions,
         suggested_proposal_inputs = excluded.suggested_proposal_inputs,
         generated_file_references = excluded.generated_file_references,
         completed_at = excluded.completed_at`,
    )
    .run(
      record.id,
      record.consultationId,
      record.summary,
      JSON.stringify(record.keyFindings),
      JSON.stringify(record.evidenceReferences),
      JSON.stringify(record.assumptions),
      JSON.stringify(record.uncertainties),
      JSON.stringify(record.recommendedActions),
      JSON.stringify(record.suggestedProposalInputs),
      JSON.stringify(record.generatedFileReferences),
      record.completedAt,
    );
}

export function dbGetConsultationResult(id: string): ConsultationResultRecord | null {
  const row = getSqlite().prepare("SELECT * FROM consultation_results WHERE id = ?").get(id) as
    | ConsultationResultRow
    | undefined;
  return row ? consultationResultFromRow(row) : null;
}

export function dbGetConsultationResultForConsultation(
  consultationId: string,
): ConsultationResultRecord | null {
  const row = getSqlite()
    .prepare(
      "SELECT * FROM consultation_results WHERE consultation_id = ? ORDER BY completed_at DESC, rowid DESC LIMIT 1",
    )
    .get(consultationId) as ConsultationResultRow | undefined;
  return row ? consultationResultFromRow(row) : null;
}

interface PanelMembershipRow {
  parent_panel_consultation_id: string;
  child_consultation_id: string;
  member_role: string;
  required_or_optional: string;
  sequence_or_weight: number;
}

function panelMembershipFromRow(row: PanelMembershipRow): PanelMembershipRecord {
  return {
    parentPanelConsultationId: row.parent_panel_consultation_id,
    childConsultationId: row.child_consultation_id,
    memberRole: row.member_role as PanelMembershipRecord["memberRole"],
    requiredOrOptional: row.required_or_optional as PanelMembershipRecord["requiredOrOptional"],
    sequenceOrWeight: row.sequence_or_weight,
  };
}

export function dbInsertPanelMembership(record: PanelMembershipRecord): void {
  getSqlite()
    .prepare(
      `INSERT INTO panel_membership (
        parent_panel_consultation_id, child_consultation_id, member_role,
        required_or_optional, sequence_or_weight
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(parent_panel_consultation_id, child_consultation_id) DO UPDATE SET
         member_role = excluded.member_role,
         required_or_optional = excluded.required_or_optional,
         sequence_or_weight = excluded.sequence_or_weight`,
    )
    .run(
      record.parentPanelConsultationId,
      record.childConsultationId,
      record.memberRole,
      record.requiredOrOptional,
      record.sequenceOrWeight,
    );
}

export function dbListPanelMembers(parentPanelConsultationId: string): PanelMembershipRecord[] {
  const rows = getSqlite()
    .prepare(
      "SELECT * FROM panel_membership WHERE parent_panel_consultation_id = ? ORDER BY sequence_or_weight ASC, rowid ASC",
    )
    .all(parentPanelConsultationId) as PanelMembershipRow[];
  return rows.map(panelMembershipFromRow);
}
