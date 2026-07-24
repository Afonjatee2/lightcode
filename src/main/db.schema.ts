import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  locationKind: text("location_kind").notNull(), // "windows" | "wsl" | "posix"
  locationPath: text("location_path"), // for windows/posix
  locationDistro: text("location_distro"), // for wsl
  locationLinuxPath: text("location_linux_path"), // for wsl
  locationUncPath: text("location_unc_path"), // for wsl
  lastDraftConfig: text("last_draft_config"), // JSON
  scripts: text("scripts"), // JSON
  searchSettings: text("search_settings"), // JSON
  mcpServers: text("mcp_servers"), // JSON
  purpose: text("purpose"), // Project purpose; null means legacy/default code project
  campaignExtension: text("campaign_extension"), // Full Phase 3 campaign extension JSON
  // Legacy migration compatibility only. `campaign_extension` is the canonical campaign identity.
  campaignGroupId: text("campaign_group_id"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  agentKind: text("agent_kind").notNull(), // provider kind
  /** Optional id of a user-registered ACP instance backing this thread. */
  agentInstanceId: text("agent_instance_id"),
  config: text("config").notNull(), // JSON
  status: text("status").notNull(),
  attention: text("attention").notNull(),
  threadStatusSource: text("thread_status_source"), // "cli_hook" | "terminal_parse" | "server"
  canResumeWithConfig: integer("can_resume_with_config", { mode: "boolean" })
    .notNull()
    .default(false),
  sessionRef: text("session_ref"), // JSON
  terminalPrompt: text("terminal_prompt"), // JSON
  worktreePath: text("worktree_path"),
  worktreeBranch: text("worktree_branch"),
  prNumber: integer("pr_number"),
  groupId: text("group_id"),
  groupName: text("group_name"),
  /** Orchestrator thread that created this one via the Crossagents MCP. */
  parentThreadId: text("parent_thread_id"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  doneAt: text("done_at"),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  /** "terminal" (xterm-backed PTY) vs "gui" (renderer-native chat). */
  presentationMode: text("presentation_mode").notNull().default("terminal"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  activeTurnStartedAt: text("active_turn_started_at"),
  lastTurnStartedAt: text("last_turn_started_at"),
  lastTurnEndedAt: text("last_turn_ended_at"),
});

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
});

export const remoteCommandReceipts = sqliteTable("remote_command_receipts", {
  commandId: text("command_id").primaryKey(),
  route: text("route").notNull(),
  state: text("state").notNull(),
  response: text("response"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Per-project notes panel content. One row per project, keyed by project id.
 * `doc` holds the TipTap (ProseMirror) JSON for the free-form notes editor;
 * `todos` holds the structured to-do list. Kept in its own table (rather than a
 * `projects` column synced via `dbSyncAll`) so editing notes does not rewrite
 * the entire projects+threads snapshot on every keystroke. Orphan rows are
 * cleaned up explicitly on project deletion (see db.ts), so no FK is declared —
 * this avoids an insert/sync ordering race for a brand-new project.
 */
export const projectNotes = sqliteTable("project_notes", {
  projectId: text("project_id").primaryKey(),
  doc: text("doc"), // JSON (TipTap document), nullable when empty
  todos: text("todos").notNull().default("[]"), // JSON array of NotesTodoItem
  updatedAt: text("updated_at").notNull(),
});

/**
 * Persisted canonical chat items per thread (for renderer-native chat mode).
 * Mirrors the renderer's `RuntimeChatItem` shape so we can hydrate the chat
 * UI when the user reopens a thread.
 */
export const threadRuntimeItems = sqliteTable(
  "thread_runtime_items",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    state: text("state").notNull(),
    payload: text("payload"), // JSON, nullable
    streams: text("streams"), // JSON of Partial<Record<RuntimeContentStreamKind, string>>
    parentItemId: text("parent_item_id"), // sub-agent parent tool_call id, nullable
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.itemId] }),
  }),
);

/**
 * Latest provider-reported context-window usage per thread. One row per
 * thread; rewritten alongside the runtime snapshot so the indicator can
 * recover after app restart or session resume (providers only emit fresh
 * `context.updated` values on the next assistant response).
 */
export const threadContextUsage = sqliteTable("thread_context_usage", {
  threadId: text("thread_id")
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  usage: text("usage").notNull(),
});

/**
 * Frozen per-turn timing windows. One row per completed turn (first user
 * input → thread settles back to idle), in chronological order via `idx`.
 * `anchorItemId` points at the last canonical item present when the turn
 * closed; the chat surface renders the inline "Worked for X" beneath that row.
 */
export const threadCompletedTurns = sqliteTable(
  "thread_completed_turns",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at").notNull(),
    anchorItemId: text("anchor_item_id"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.idx] }),
  }),
);

/** Phase 4 campaign consultations (durable; survives supervisor restart). */
export const consultations = sqliteTable("consultations", {
  id: text("id").primaryKey(),
  parentProjectId: text("parent_project_id").notNull(),
  parentThreadId: text("parent_thread_id").notNull(),
  campaignGroupId: text("campaign_group_id").notNull(),
  childThreadOrRunId: text("child_thread_or_run_id"),
  originalMention: text("original_mention").notNull(),
  originalInstruction: text("original_instruction").notNull(),
  resolvedRole: text("resolved_role").notNull(),
  requestedProvider: text("requested_provider"),
  actualProvider: text("actual_provider"),
  requestedModel: text("requested_model"),
  actualModel: text("actual_model"),
  consultationMode: text("consultation_mode").notNull(),
  status: text("status").notNull(),
  contextPacketId: text("context_packet_id"),
  permissionPolicyVersion: text("permission_policy_version").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  cancelledAt: text("cancelled_at"),
  failureCode: text("failure_code"),
  safeFailureMessage: text("safe_failure_message"),
  resultSummaryId: text("result_summary_id"),
  retryOfConsultationId: text("retry_of_consultation_id"),
  panelCompletionRule: text("panel_completion_rule"), // JSON, panel consultations only
});

export const contextPackets = sqliteTable("context_packets", {
  id: text("id").primaryKey(),
  consultationId: text("consultation_id")
    .notNull()
    .references(() => consultations.id, { onDelete: "cascade" }),
  structuredContext: text("structured_context").notNull(), // JSON
  contentHash: text("content_hash").notNull(),
  contractVersion: text("contract_version").notNull(),
  redactionMetadata: text("redaction_metadata").notNull(), // JSON
  evidenceFreshness: text("evidence_freshness").notNull(), // JSON
  missingDataWarnings: text("missing_data_warnings").notNull(), // JSON array
  createdAt: text("created_at").notNull(),
});

export const threadSummaries = sqliteTable("thread_summaries", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  summary: text("summary").notNull(),
  sourceCursor: text("source_cursor").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const consultationResults = sqliteTable("consultation_results", {
  id: text("id").primaryKey(),
  consultationId: text("consultation_id")
    .notNull()
    .references(() => consultations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  keyFindings: text("key_findings").notNull(), // JSON array
  evidenceReferences: text("evidence_references").notNull(), // JSON array
  assumptions: text("assumptions").notNull(), // JSON array
  uncertainties: text("uncertainties").notNull(), // JSON array
  recommendedActions: text("recommended_actions").notNull(), // JSON array
  suggestedProposalInputs: text("suggested_proposal_inputs").notNull(), // JSON array
  generatedFileReferences: text("generated_file_references").notNull(), // JSON array
  completedAt: text("completed_at").notNull(),
});

export const panelMembership = sqliteTable(
  "panel_membership",
  {
    parentPanelConsultationId: text("parent_panel_consultation_id")
      .notNull()
      .references(() => consultations.id, { onDelete: "cascade" }),
    childConsultationId: text("child_consultation_id")
      .notNull()
      .references(() => consultations.id, { onDelete: "cascade" }),
    memberRole: text("member_role").notNull(),
    requiredOrOptional: text("required_or_optional").notNull(),
    sequenceOrWeight: integer("sequence_or_weight").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentPanelConsultationId, table.childConsultationId] }),
  }),
);
