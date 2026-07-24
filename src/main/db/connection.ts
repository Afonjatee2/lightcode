import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db.schema";

let _db: ReturnType<typeof drizzle> | undefined;
let _sqlite: InstanceType<typeof Database> | undefined;

/**
 * Project/thread ids the renderer's persisted store has actually been shown
 * — via its initial `dbGetProjects`/`dbGetThreads` hydration read, or via a
 * prior `dbSyncAll` snapshot it sent. `dbSyncAll` does full-snapshot
 * reconciliation (anything missing from its incoming arrays is deleted), but
 * several code paths write a *new* project/thread directly (home-scope
 * bootstrap, orchestrator child threads, remote/mobile thread commands) while
 * a renderer window is already live. Without this guard, the very next
 * unrelated store mutation persists the renderer's still-stale snapshot and
 * `dbSyncAll` deletes the row it never had a chance to learn about — see
 * `markProjectIdsKnown`/`markThreadIdsKnown` and their use in `dbSyncAll`.
 */
let _knownProjectIds = new Set<string>();
let _knownThreadIds = new Set<string>();

/**
 * Monotonic counter bumped ONLY by writes the profile actually reads — the
 * durable usage_events log (dbAppendUsageEvents) and identity edits. The profile
 * caches key on this, so high-frequency chat persistence (runtime snapshots/
 * turns) does NOT churn the cache during active sessions.
 */
let _profileDataGeneration = 0;
export function getProfileDataGeneration(): number {
  return _profileDataGeneration;
}
export function bumpProfileDataGeneration(): void {
  _profileDataGeneration++;
}

/** How long durable usage events are retained (well beyond the 364-day heatmap). */
const USAGE_EVENTS_RETENTION_DAYS = 730;
const REMOTE_COMMAND_RECEIPTS_RETENTION_DAYS = 30;

const HEADLESS_SERVER_ENV = "PORACODE_HEADLESS_SERVER";
const BETTER_SQLITE_NATIVE_BINDING_ENV = "PORACODE_BETTER_SQLITE3_NATIVE_BINDING";
const DEFAULT_SERVER_NATIVE_BINDING = join("dist", "server-native", "better_sqlite3.node");

export function resolveBetterSqliteNativeBindingOptions(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  bindingExists: (path: string) => boolean = existsSync,
  // db.ts is bundled to dist/main/*.cjs, so __dirname is the emitted dir.
  moduleDir = __dirname,
): ConstructorParameters<typeof Database>[1] | undefined {
  const explicit = env[BETTER_SQLITE_NATIVE_BINDING_ENV]?.trim();
  if (explicit) {
    if (!bindingExists(explicit)) {
      throw new Error(
        `${BETTER_SQLITE_NATIVE_BINDING_ENV} points to a file that does not exist: ${explicit}. ` +
          "Set it to a Node-ABI better_sqlite3.node built for this Node runtime, or unset it.",
      );
    }
    return { nativeBinding: explicit };
  }
  if (env[HEADLESS_SERVER_ENV] !== "1") return undefined;
  // The prepared Node-ABI binding may sit relative to the process CWD (repo
  // root, dev) OR relative to the emitted server bundle (packaged: server.cjs
  // in dist/main, so ../server-native/better_sqlite3.node). Launching the built
  // CLI from any other dir (systemd/launchd/cron) misses the cwd-relative path,
  // so probe both and prefer whichever exists.
  const candidates = [
    join(cwd, DEFAULT_SERVER_NATIVE_BINDING),
    join(moduleDir, "..", "server-native", "better_sqlite3.node"),
  ];
  const found = candidates.find((candidate) => bindingExists(candidate));
  return found ? { nativeBinding: found } : undefined;
}

function openDatabase(dbPath: string): InstanceType<typeof Database> {
  const options = resolveBetterSqliteNativeBindingOptions();
  try {
    return new Database(dbPath, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("NODE_MODULE_VERSION")) {
      throw new Error(
        [
          "better-sqlite3 native binding is not compatible with this Node runtime.",
          "For the headless server, run `pnpm run prepare:server-native` or set",
          `${BETTER_SQLITE_NATIVE_BINDING_ENV} to a Node-ABI better_sqlite3.node file.`,
        ].join(" "),
        { cause: error },
      );
    }
    throw error;
  }
}

export function initDatabase(dbPath: string) {
  console.log(`[db] opening ${dbPath}`);
  const sqlite = openDatabase(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  _sqlite = sqlite;
  _db = drizzle({ client: sqlite, schema });
  _knownProjectIds = new Set();
  _knownThreadIds = new Set();

  // Create tables if they don't exist.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location_kind TEXT NOT NULL,
      location_path TEXT,
      location_distro TEXT,
      location_linux_path TEXT,
      location_unc_path TEXT,
      last_draft_config TEXT,
      scripts TEXT,
      mcp_servers TEXT,
      purpose TEXT,
      campaign_extension TEXT,
      campaign_group_id TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agent_kind TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL,
      attention TEXT NOT NULL,
      can_resume_with_config INTEGER NOT NULL DEFAULT 0,
      session_ref TEXT,
      terminal_prompt TEXT,
      worktree_path TEXT,
      worktree_branch TEXT,
      pr_number INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      active_turn_started_at TEXT,
      last_turn_started_at TEXT,
      last_turn_ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thread_runtime_items (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      state TEXT NOT NULL,
      payload TEXT,
      streams TEXT,
      PRIMARY KEY (thread_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_items_thread_pos
      ON thread_runtime_items (thread_id, position);
    CREATE TABLE IF NOT EXISTS thread_completed_turns (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      anchor_item_id TEXT,
      PRIMARY KEY (thread_id, idx)
    );
    CREATE TABLE IF NOT EXISTS thread_context_usage (
      thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      usage TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_notes (
      project_id TEXT PRIMARY KEY,
      doc TEXT,
      todos TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      mode TEXT,
      fast INTEGER NOT NULL DEFAULT 0,
      effort TEXT,
      name TEXT,
      value INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_usage_events_kind ON usage_events (kind);
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent_kind TEXT NOT NULL,
      config TEXT NOT NULL,
      recurrence TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      project_id TEXT,
      next_run_at TEXT,
      last_run_at TEXT,
      last_completed_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'never',
      last_result TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
      ON scheduled_tasks (enabled, next_run_at);
    CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_schedule
      ON scheduled_task_runs (schedule_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS remote_command_receipts (
      command_id TEXT PRIMARY KEY,
      route TEXT NOT NULL,
      state TEXT NOT NULL,
      response TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_remote_command_receipts_updated
      ON remote_command_receipts (updated_at);
    CREATE TABLE IF NOT EXISTS consultations (
      id TEXT PRIMARY KEY,
      parent_project_id TEXT NOT NULL,
      parent_thread_id TEXT NOT NULL,
      campaign_group_id TEXT NOT NULL,
      child_thread_or_run_id TEXT,
      original_mention TEXT NOT NULL,
      original_instruction TEXT NOT NULL,
      resolved_role TEXT NOT NULL,
      requested_provider TEXT,
      actual_provider TEXT,
      requested_model TEXT,
      actual_model TEXT,
      consultation_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      context_packet_id TEXT,
      permission_policy_version TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      failure_code TEXT,
      safe_failure_message TEXT,
      result_summary_id TEXT,
      retry_of_consultation_id TEXT,
      panel_completion_rule TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_consultations_parent_thread
      ON consultations (parent_thread_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_consultations_campaign_group
      ON consultations (campaign_group_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_status
      ON consultations (status);
    CREATE INDEX IF NOT EXISTS idx_consultations_child_run
      ON consultations (child_thread_or_run_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_created
      ON consultations (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_consultations_retry
      ON consultations (retry_of_consultation_id);
    CREATE TABLE IF NOT EXISTS context_packets (
      id TEXT PRIMARY KEY,
      consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
      structured_context TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      contract_version TEXT NOT NULL,
      redaction_metadata TEXT NOT NULL,
      evidence_freshness TEXT NOT NULL,
      missing_data_warnings TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_context_packets_consultation
      ON context_packets (consultation_id);
    CREATE TABLE IF NOT EXISTS thread_summaries (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_cursor TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thread_summaries_thread
      ON thread_summaries (thread_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS consultation_results (
      id TEXT PRIMARY KEY,
      consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      key_findings TEXT NOT NULL,
      evidence_references TEXT NOT NULL,
      assumptions TEXT NOT NULL,
      uncertainties TEXT NOT NULL,
      recommended_actions TEXT NOT NULL,
      suggested_proposal_inputs TEXT NOT NULL,
      generated_file_references TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consultation_results_consultation
      ON consultation_results (consultation_id);
    CREATE TABLE IF NOT EXISTS panel_membership (
      parent_panel_consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
      child_consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
      member_role TEXT NOT NULL,
      required_or_optional TEXT NOT NULL,
      sequence_or_weight INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (parent_panel_consultation_id, child_consultation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_panel_membership_child
      ON panel_membership (child_consultation_id);
  `);

  // Baseline schema version for future DB migrations.
  // New upgrade steps should live behind this gate when we need them.
  const SCHEMA_VERSION = 30;

  const storedVersion = Number(
    (
      sqlite.prepare("SELECT value FROM app_state WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined
    )?.value ?? "0",
  );

  if (storedVersion < 2) {
    const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "done")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN done INTEGER NOT NULL DEFAULT 0");
    }
  }

  if (storedVersion < 3) {
    const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "group_id")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN group_id TEXT");
    }
  }

  if (storedVersion < 4) {
    const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "group_name")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN group_name TEXT");
    }
  }

  if (storedVersion < 5) {
    const cols = sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "search_settings")) {
      sqlite.exec("ALTER TABLE projects ADD COLUMN search_settings TEXT");
    }
  }

  if (storedVersion < 6) {
    const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "starred")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN starred INTEGER NOT NULL DEFAULT 0");
    }
  }

  if (storedVersion < 7) {
    // Fold model-id context-size suffixes (e.g. `claude-opus-4-7[1m]`) into a
    // separate `contextSize` field so the UI can pick model and context size
    // independently. Adapter argv reattaches the suffix at PTY launch.
    foldContextSuffix(sqlite, "threads", "config");
    foldContextSuffix(sqlite, "projects", "last_draft_config");
  }

  if (storedVersion < 8) {
    // Per-thread presentation mode (terminal vs renderer-native chat) +
    // optional reference to a user-registered ACP instance.
    const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "presentation_mode")) {
      sqlite.exec(
        "ALTER TABLE threads ADD COLUMN presentation_mode TEXT NOT NULL DEFAULT 'terminal'",
      );
    }
    if (!cols.some((c) => c.name === "agent_instance_id")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN agent_instance_id TEXT");
    }
  }

  if (storedVersion < 9) {
    // Persisted canonical chat items per thread (chat-mode hydration on reopen).
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS thread_runtime_items (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        type TEXT NOT NULL,
        state TEXT NOT NULL,
        payload TEXT,
        streams TEXT,
        PRIMARY KEY (thread_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_items_thread_pos
        ON thread_runtime_items (thread_id, position);
    `);
  }

  if (storedVersion < 10) {
    // Sub-agent grouping: child items (from Claude `Task` tool use) carry the
    // parent tool_call's id so the chat timeline groups them under their
    // parent on reload, matching live behaviour.
    const cols = sqlite.prepare("PRAGMA table_info(thread_runtime_items)").all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "parent_item_id")) {
      sqlite.exec("ALTER TABLE thread_runtime_items ADD COLUMN parent_item_id TEXT");
    }
  }

  if (storedVersion < 11) {
    const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "active_turn_started_at")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN active_turn_started_at TEXT");
    }
    if (!cols.some((c) => c.name === "last_turn_started_at")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN last_turn_started_at TEXT");
    }
    if (!cols.some((c) => c.name === "last_turn_ended_at")) {
      sqlite.exec("ALTER TABLE threads ADD COLUMN last_turn_ended_at TEXT");
    }
  }

  if (storedVersion < 12) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS thread_completed_turns (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        anchor_item_id TEXT,
        PRIMARY KEY (thread_id, idx)
      );
    `);
  }

  if (storedVersion < SCHEMA_VERSION) {
    if (storedVersion < 13) {
      const cols = sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "disabled")) {
        sqlite.exec("ALTER TABLE projects ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
      }
    }

    if (storedVersion < 14) {
      const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "done_at")) {
        sqlite.exec("ALTER TABLE threads ADD COLUMN done_at TEXT");
      }
    }

    if (storedVersion < 15) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS thread_context_usage (
          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
          usage TEXT NOT NULL
        );
      `);
    }

    if (storedVersion < 16) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS project_notes (
          project_id TEXT PRIMARY KEY,
          doc TEXT,
          todos TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        );
      `);
    }

    if (storedVersion < 19) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          kind TEXT NOT NULL,
          provider TEXT,
          model TEXT,
          mode TEXT,
          fast INTEGER NOT NULL DEFAULT 0,
          effort TEXT,
          name TEXT,
          value INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_usage_events_kind ON usage_events (kind);
      `);
    }

    if (storedVersion < 20) {
      // Persist the thread status source so headless status persistence can
      // round-trip it (previously in-memory only; dropped on DB write).
      const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "thread_status_source")) {
        sqlite.exec("ALTER TABLE threads ADD COLUMN thread_status_source TEXT");
      }
    }

    if (storedVersion < 21) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          agent_kind TEXT NOT NULL,
          config TEXT NOT NULL,
          recurrence TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          next_run_at TEXT,
          last_run_at TEXT,
          last_completed_at TEXT,
          last_status TEXT NOT NULL DEFAULT 'never',
          last_result TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
          ON scheduled_tasks (enabled, next_run_at);
      `);
    }

    if (storedVersion < 22) {
      // Per-schedule run history, each linked to the real GUI thread the run
      // created. ON DELETE CASCADE ties runs to their parent schedule (matches
      // the threads → projects cascade); relies on `foreign_keys = ON`.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_task_runs (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          status TEXT NOT NULL,
          summary TEXT,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_schedule
          ON scheduled_task_runs (schedule_id, started_at DESC);
      `);
    }

    if (storedVersion < 23) {
      // Per-schedule target project: the run's GUI thread is created in this
      // project (NULL = the built-in "Home" scope). Nullable so existing rows
      // keep running under Home.
      const cols = sqlite.prepare("PRAGMA table_info(scheduled_tasks)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "project_id")) {
        sqlite.exec("ALTER TABLE scheduled_tasks ADD COLUMN project_id TEXT");
      }
    }

    if (storedVersion < 24) {
      const cols = sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "mcp_servers")) {
        sqlite.exec("ALTER TABLE projects ADD COLUMN mcp_servers TEXT");
      }
    }

    if (storedVersion < 25) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS remote_command_receipts (
          command_id TEXT PRIMARY KEY,
          route TEXT NOT NULL,
          state TEXT NOT NULL,
          response TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_remote_command_receipts_updated
          ON remote_command_receipts (updated_at);
      `);
    }

    if (storedVersion < 26) {
      // Orchestrator (Crossagents MCP) parenthood, previously in-memory only.
      // Persisting it lets the supervisor re-address child threads after a
      // restart and lets the sidebar group children with their parent.
      const cols = sqlite.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "parent_thread_id")) {
        sqlite.exec("ALTER TABLE threads ADD COLUMN parent_thread_id TEXT");
      }
    }

    if (storedVersion < 27) {
      // Phase 4 campaign consultations: durable consultations, their context
      // packets, thread summaries, results and panel membership (previously an
      // in-memory store that did not survive a restart).
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS consultations (
          id TEXT PRIMARY KEY,
          parent_project_id TEXT NOT NULL,
          parent_thread_id TEXT NOT NULL,
          campaign_group_id TEXT NOT NULL,
          child_thread_or_run_id TEXT,
          original_mention TEXT NOT NULL,
          original_instruction TEXT NOT NULL,
          resolved_role TEXT NOT NULL,
          requested_provider TEXT,
          actual_provider TEXT,
          requested_model TEXT,
          actual_model TEXT,
          consultation_mode TEXT NOT NULL,
          status TEXT NOT NULL,
          context_packet_id TEXT,
          permission_policy_version TEXT NOT NULL,
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          failure_code TEXT,
          safe_failure_message TEXT,
          result_summary_id TEXT,
          retry_of_consultation_id TEXT,
          panel_completion_rule TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_consultations_parent_thread
          ON consultations (parent_thread_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_consultations_campaign_group
          ON consultations (campaign_group_id);
        CREATE INDEX IF NOT EXISTS idx_consultations_status
          ON consultations (status);
        CREATE INDEX IF NOT EXISTS idx_consultations_child_run
          ON consultations (child_thread_or_run_id);
        CREATE INDEX IF NOT EXISTS idx_consultations_created
          ON consultations (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_consultations_retry
          ON consultations (retry_of_consultation_id);
        CREATE TABLE IF NOT EXISTS context_packets (
          id TEXT PRIMARY KEY,
          consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
          structured_context TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          contract_version TEXT NOT NULL,
          redaction_metadata TEXT NOT NULL,
          evidence_freshness TEXT NOT NULL,
          missing_data_warnings TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_context_packets_consultation
          ON context_packets (consultation_id);
        CREATE TABLE IF NOT EXISTS thread_summaries (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          source_cursor TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_thread_summaries_thread
          ON thread_summaries (thread_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS consultation_results (
          id TEXT PRIMARY KEY,
          consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
          summary TEXT NOT NULL,
          key_findings TEXT NOT NULL,
          evidence_references TEXT NOT NULL,
          assumptions TEXT NOT NULL,
          uncertainties TEXT NOT NULL,
          recommended_actions TEXT NOT NULL,
          suggested_proposal_inputs TEXT NOT NULL,
          generated_file_references TEXT NOT NULL,
          completed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_consultation_results_consultation
          ON consultation_results (consultation_id);
        CREATE TABLE IF NOT EXISTS panel_membership (
          parent_panel_consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
          child_consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
          member_role TEXT NOT NULL,
          required_or_optional TEXT NOT NULL,
          sequence_or_weight INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (parent_panel_consultation_id, child_consultation_id)
        );
        CREATE INDEX IF NOT EXISTS idx_panel_membership_child
          ON panel_membership (child_consultation_id);
      `);
    }

    if (storedVersion < 28) {
      // Legacy bridge retained only for compatibility with earlier Phase 4 work.
      const cols = sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "campaign_group_id")) {
        sqlite.exec("ALTER TABLE projects ADD COLUMN campaign_group_id TEXT");
      }
    }

    if (storedVersion < 29) {
      // Persist the complete Phase 3 project model. Legacy rows that only carry
      // campaign_group_id are not upgraded with invented names or defaults.
      const cols = sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "purpose")) {
        sqlite.exec("ALTER TABLE projects ADD COLUMN purpose TEXT");
      }
      if (!cols.some((c) => c.name === "campaign_extension")) {
        sqlite.exec("ALTER TABLE projects ADD COLUMN campaign_extension TEXT");
      }
    }

    if (storedVersion < 30) {
      const cols = sqlite.prepare("PRAGMA table_info(consultations)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "panel_completion_rule")) {
        sqlite.exec("ALTER TABLE consultations ADD COLUMN panel_completion_rule TEXT");
      }
    }

    sqlite
      .prepare(
        "INSERT INTO app_state (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(SCHEMA_VERSION));
  }

  repairExpectedColumns(sqlite);

  // Bound the durable usage log: drop events older than the retention window so
  // a long-lived install can't accumulate unboundedly (aggregation reads scan
  // this table). Runs once per startup; cheap on a bounded table.
  try {
    const cutoff = Date.now() - USAGE_EVENTS_RETENTION_DAYS * 86_400_000;
    sqlite.prepare("DELETE FROM usage_events WHERE ts < ?").run(cutoff);
  } catch {
    // usage_events may not exist on a partially-migrated db; ignore.
  }

  const receiptCutoff = Date.now() - REMOTE_COMMAND_RECEIPTS_RETENTION_DAYS * 86_400_000;
  sqlite.prepare("DELETE FROM remote_command_receipts WHERE updated_at < ?").run(receiptCutoff);

  console.log("[db] initialized");
  return _db;
}

/**
 * Columns the current code reads unconditionally, paired with the DDL that adds
 * them. The numbered ladder above only runs for databases below each version,
 * so a database stamped by a divergent build — same version number, different
 * columns — skips migrations it still needs and every query touching the
 * missing column throws. This pass is version-independent and idempotent, so
 * such a database heals itself on the next launch instead of failing opaquely.
 */
const EXPECTED_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  {
    table: "projects",
    column: "campaign_group_id",
    ddl: "ALTER TABLE projects ADD COLUMN campaign_group_id TEXT",
  },
  { table: "projects", column: "purpose", ddl: "ALTER TABLE projects ADD COLUMN purpose TEXT" },
  {
    table: "projects",
    column: "campaign_extension",
    ddl: "ALTER TABLE projects ADD COLUMN campaign_extension TEXT",
  },
  {
    table: "consultations",
    column: "panel_completion_rule",
    ddl: "ALTER TABLE consultations ADD COLUMN panel_completion_rule TEXT",
  },
];

export function repairExpectedColumns(sqlite: InstanceType<typeof Database>): string[] {
  const repaired: string[] = [];
  for (const { table, column, ddl } of EXPECTED_COLUMNS) {
    const tableExists = sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!tableExists) continue;
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === column)) continue;
    sqlite.exec(ddl);
    repaired.push(`${table}.${column}`);
  }
  if (repaired.length > 0) {
    console.warn(`[db] repaired missing columns: ${repaired.join(", ")}`);
  }
  return repaired;
}

function foldContextSuffix(sqlite: InstanceType<typeof Database>, table: string, column: string) {
  const rows = sqlite
    .prepare(`SELECT rowid AS rowid, ${column} AS json FROM ${table} WHERE ${column} IS NOT NULL`)
    .all() as { rowid: number; json: string }[];
  const update = sqlite.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
  const suffix = /\[([0-9]+[mk])\]$/i;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.json);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const cfg = parsed as { model?: unknown; contextSize?: unknown };
    if (typeof cfg.model !== "string") continue;
    const match = cfg.model.match(suffix);
    if (!match) continue;
    cfg.model = cfg.model.slice(0, -match[0].length);
    if (typeof cfg.contextSize !== "string") {
      cfg.contextSize = match[1]!.toLowerCase();
    }
    update.run(JSON.stringify(cfg), row.rowid);
  }
}

export function getDb() {
  if (!_db) throw new Error("Database not initialized");
  return _db;
}

/**
 * Raw better-sqlite3 handle for modules that issue prepared statements directly.
 * Throws with the same message as {@link getDb} when the database is not open.
 */
export function getSqlite(): InstanceType<typeof Database> {
  if (!_sqlite) throw new Error("Database not initialized");
  return _sqlite;
}

const WRITE_TRANSACTION_MAX_ATTEMPTS = 5;
const WRITE_TRANSACTION_RETRY_BASE_DELAY_MS = 20;

function isRetryableSqliteBusyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT";
}

/** Synchronous sleep — better-sqlite3 is synchronous, so retries here must block, not await. */
function blockingSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs a better-sqlite3 write transaction, retrying the whole thing from
 * scratch if it collides with another connection's write to the same file.
 *
 * The desktop main process and the forked supervisor process each open their
 * own connection to the same on-disk database (WAL mode is what makes that
 * safe) — see `ensureSupervisorDatabase` in `supervisorRuntime.ts`. A deferred
 * `sqlite.transaction()` establishes its read snapshot on its first
 * statement; if the *other* connection commits a write before this one
 * attempts to upgrade to a write lock, SQLite returns `SQLITE_BUSY_SNAPSHOT`
 * immediately — `PRAGMA busy_timeout` does NOT apply to this code, because
 * waiting cannot help a snapshot that is already stale. The only correct fix
 * is to restart the transaction so it takes a fresh snapshot; a plain
 * `SQLITE_BUSY` (lock contention busy_timeout didn't fully absorb) benefits
 * from the same retry. Left uncaught, either one used to crash the whole
 * process as an uncaught `SqliteError`.
 */
export function runWriteTransaction<T>(sqlite: InstanceType<typeof Database>, fn: () => T): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return sqlite.transaction(fn)();
    } catch (error) {
      if (attempt >= WRITE_TRANSACTION_MAX_ATTEMPTS || !isRetryableSqliteBusyError(error)) {
        throw error;
      }
      blockingSleep(WRITE_TRANSACTION_RETRY_BASE_DELAY_MS * attempt);
    }
  }
}

export function closeDatabase() {
  const sqlite = _sqlite;
  if (sqlite) {
    // With journal_mode=WAL + synchronous=NORMAL, committed transactions live
    // in the -wal file and only become durable across an OS crash/power loss
    // after a checkpoint. Fold the WAL back into the main db on shutdown so the
    // most recent writes (threads/messages the user just made) are not at risk
    // if `close()`'s implicit checkpoint is skipped on an unclean exit.
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    } catch (error) {
      console.error("[db] wal_checkpoint on close failed:", error);
    }
    sqlite.close();
  }
  _sqlite = undefined;
  _db = undefined;
  _knownProjectIds = new Set();
  _knownThreadIds = new Set();
}

/** Records that the renderer's store has now seen these project ids (see `_knownProjectIds`). */
export function markProjectIdsKnown(ids: Iterable<string>): void {
  for (const id of ids) _knownProjectIds.add(id);
}

/** Records that the renderer's store has now seen these thread ids (see `_knownThreadIds`). */
export function markThreadIdsKnown(ids: Iterable<string>): void {
  for (const id of ids) _knownThreadIds.add(id);
}

export function isProjectIdKnown(id: string): boolean {
  return _knownProjectIds.has(id);
}

export function isThreadIdKnown(id: string): boolean {
  return _knownThreadIds.has(id);
}
