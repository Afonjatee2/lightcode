import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import type { ProjectLocation, Project, Thread } from "@/shared/contracts";
import * as schema from "./db.schema";

let _db: ReturnType<typeof drizzle> | undefined;
let _sqlite: InstanceType<typeof Database> | undefined;

export function initDatabase(dbPath: string) {
  console.log(`[db] opening ${dbPath}`);
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  _sqlite = sqlite;
  _db = drizzle({ client: sqlite, schema });

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
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
  `);

  // Baseline schema version for future DB migrations.
  // New upgrade steps should live behind this gate when we need them.
  const SCHEMA_VERSION = 9;

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

  if (storedVersion < SCHEMA_VERSION) {
    sqlite
      .prepare(
        "INSERT INTO app_state (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(SCHEMA_VERSION));
  }

  console.log("[db] initialized");
  return _db;
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

export function closeDatabase() {
  _sqlite?.close();
  _sqlite = undefined;
  _db = undefined;
}

// ── Converters ──────────────────────────────────────────────────────

function locationToRow(loc: ProjectLocation) {
  return {
    locationKind: loc.kind,
    locationPath: loc.kind !== "wsl" ? loc.path : null,
    locationDistro: loc.kind === "wsl" ? loc.distro : null,
    locationLinuxPath: loc.kind === "wsl" ? loc.linuxPath : null,
    locationUncPath: loc.kind === "wsl" ? loc.uncPath : null,
  };
}

function rowToLocation(row: {
  locationKind: string;
  locationPath: string | null;
  locationDistro: string | null;
  locationLinuxPath: string | null;
  locationUncPath: string | null;
}): ProjectLocation {
  if (row.locationKind === "wsl") {
    return {
      kind: "wsl",
      distro: row.locationDistro!,
      linuxPath: row.locationLinuxPath!,
      uncPath: row.locationUncPath!,
    };
  }
  if (row.locationKind === "posix") {
    return { kind: "posix", path: row.locationPath! };
  }
  return { kind: "windows", path: row.locationPath! };
}

function rowToProject(row: typeof schema.projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    location: rowToLocation(row),
    ...(row.lastDraftConfig ? { lastDraftConfig: JSON.parse(row.lastDraftConfig) } : {}),
    ...(row.scripts ? { scripts: JSON.parse(row.scripts) } : {}),
    ...(row.searchSettings ? { searchSettings: JSON.parse(row.searchSettings) } : {}),
    createdAt: row.createdAt,
  };
}

function rowToThread(row: typeof schema.threads.$inferSelect): Thread {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    agentKind: row.agentKind as Thread["agentKind"],
    ...(row.agentInstanceId ? { agentInstanceId: row.agentInstanceId } : {}),
    config: JSON.parse(row.config),
    status: row.status as Thread["status"],
    attention: row.attention as Thread["attention"],
    canResumeWithConfig: row.canResumeWithConfig,
    ...(row.sessionRef ? { sessionRef: JSON.parse(row.sessionRef) } : {}),
    ...(row.worktreePath ? { worktreePath: row.worktreePath } : {}),
    ...(row.worktreeBranch ? { worktreeBranch: row.worktreeBranch } : {}),
    ...(row.prNumber != null ? { prNumber: row.prNumber } : {}),
    ...(row.groupId ? { groupId: row.groupId } : {}),
    ...(row.groupName ? { groupName: row.groupName } : {}),
    archived: row.archived,
    done: row.done,
    starred: row.starred,
    presentationMode: (row.presentationMode === "gui"
      ? "gui"
      : "terminal") as Thread["presentationMode"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Public query functions (called from IPC handlers) ───────────────

export function dbGetProjects(): Project[] {
  const db = getDb();
  return db
    .select()
    .from(schema.projects)
    .orderBy(asc(schema.projects.sortOrder))
    .all()
    .map(rowToProject);
}

export function dbGetThreads(): Thread[] {
  const db = getDb();
  return db
    .select()
    .from(schema.threads)
    .orderBy(asc(schema.threads.sortOrder))
    .all()
    .map(rowToThread);
}

export function dbGetState(key: string): string | null {
  const db = getDb();
  const row = db.select().from(schema.appState).where(eq(schema.appState.key, key)).get();
  return row?.value ?? null;
}

export function dbSetState(key: string, value: string): void {
  const db = getDb();
  db.insert(schema.appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appState.key, set: { value } })
    .run();
}

export function dbUpsertProject(project: Project, sortOrder: number): void {
  const db = getDb();
  db.insert(schema.projects)
    .values({
      id: project.id,
      name: project.name,
      ...locationToRow(project.location),
      lastDraftConfig: project.lastDraftConfig ? JSON.stringify(project.lastDraftConfig) : null,
      scripts: project.scripts ? JSON.stringify(project.scripts) : null,
      searchSettings: project.searchSettings ? JSON.stringify(project.searchSettings) : null,
      sortOrder,
      createdAt: project.createdAt,
    })
    .onConflictDoUpdate({
      target: schema.projects.id,
      set: {
        name: project.name,
        ...locationToRow(project.location),
        lastDraftConfig: project.lastDraftConfig ? JSON.stringify(project.lastDraftConfig) : null,
        scripts: project.scripts ? JSON.stringify(project.scripts) : null,
        searchSettings: project.searchSettings ? JSON.stringify(project.searchSettings) : null,
        sortOrder,
      },
    })
    .run();
}

export function dbUpsertThread(thread: Thread, sortOrder: number): void {
  const db = getDb();
  db.insert(schema.threads)
    .values({
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      agentKind: thread.agentKind,
      agentInstanceId: thread.agentInstanceId ?? null,
      config: JSON.stringify(thread.config),
      status: thread.status,
      attention: thread.attention,
      canResumeWithConfig: thread.canResumeWithConfig,
      sessionRef: thread.sessionRef ? JSON.stringify(thread.sessionRef) : null,
      terminalPrompt: null,
      worktreePath: thread.worktreePath ?? null,
      worktreeBranch: thread.worktreeBranch ?? null,
      prNumber: thread.prNumber ?? null,
      groupId: thread.groupId ?? null,
      groupName: thread.groupName ?? null,
      archived: thread.archived,
      done: thread.done,
      starred: thread.starred,
      presentationMode: thread.presentationMode ?? "terminal",
      sortOrder,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    })
    .onConflictDoUpdate({
      target: schema.threads.id,
      set: {
        title: thread.title,
        agentInstanceId: thread.agentInstanceId ?? null,
        config: JSON.stringify(thread.config),
        status: thread.status,
        attention: thread.attention,
        canResumeWithConfig: thread.canResumeWithConfig,
        sessionRef: thread.sessionRef ? JSON.stringify(thread.sessionRef) : null,
        terminalPrompt: null,
        worktreePath: thread.worktreePath ?? null,
        worktreeBranch: thread.worktreeBranch ?? null,
        prNumber: thread.prNumber ?? null,
        groupId: thread.groupId ?? null,
        archived: thread.archived,
        done: thread.done,
        starred: thread.starred,
        presentationMode: thread.presentationMode ?? "terminal",
        sortOrder,
        updatedAt: thread.updatedAt,
      },
    })
    .run();
}

export function dbDeleteThread(threadId: string): void {
  const db = getDb();
  db.delete(schema.threads).where(eq(schema.threads.id, threadId)).run();
}

/**
 * Persisted canonical chat items per thread. Stored as a flat table keyed by
 * (thread_id, item_id); ordered by `position` to preserve insertion order.
 * Mirrors the renderer's `RuntimeChatItem` shape (id, type, state, payload,
 * streams) so the chat UI can hydrate on reopen.
 */
export interface PersistedRuntimeItem {
  id: string;
  type: string;
  state: "started" | "updated" | "completed";
  payload: unknown;
  streams: Record<string, string>;
}

export function dbGetThreadRuntimeItems(threadId: string): PersistedRuntimeItem[] {
  if (!_sqlite) throw new Error("Database not initialized");
  const rows = _sqlite
    .prepare(
      "SELECT item_id, type, state, payload, streams FROM thread_runtime_items WHERE thread_id = ? ORDER BY position ASC",
    )
    .all(threadId) as Array<{
    item_id: string;
    type: string;
    state: string;
    payload: string | null;
    streams: string | null;
  }>;
  return rows.map((row) => ({
    id: row.item_id,
    type: row.type,
    state: (row.state === "completed" || row.state === "updated"
      ? row.state
      : "started") as PersistedRuntimeItem["state"],
    payload: row.payload ? safeParse(row.payload) : undefined,
    streams: row.streams ? (safeParse(row.streams) as Record<string, string>) : {},
  }));
}

export function dbReplaceThreadRuntimeItems(threadId: string, items: PersistedRuntimeItem[]): void {
  if (!_sqlite) throw new Error("Database not initialized");
  const replace = _sqlite.prepare(
    `INSERT INTO thread_runtime_items (thread_id, item_id, position, type, state, payload, streams)
       VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id, item_id) DO UPDATE SET
       position = excluded.position,
       type = excluded.type,
       state = excluded.state,
       payload = excluded.payload,
       streams = excluded.streams`,
  );
  const incomingIds = new Set(items.map((it) => it.id));
  const existing = _sqlite
    .prepare("SELECT item_id FROM thread_runtime_items WHERE thread_id = ?")
    .all(threadId) as Array<{ item_id: string }>;
  const removeStmt = _sqlite.prepare(
    "DELETE FROM thread_runtime_items WHERE thread_id = ? AND item_id = ?",
  );
  _sqlite.transaction(() => {
    for (const row of existing) {
      if (!incomingIds.has(row.item_id)) {
        removeStmt.run(threadId, row.item_id);
      }
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      replace.run(
        threadId,
        it.id,
        i,
        it.type,
        it.state,
        it.payload === undefined ? null : JSON.stringify(it.payload),
        JSON.stringify(it.streams ?? {}),
      );
    }
  })();
}

export function dbClearThreadRuntimeItems(threadId: string): void {
  if (!_sqlite) throw new Error("Database not initialized");
  _sqlite.prepare("DELETE FROM thread_runtime_items WHERE thread_id = ?").run(threadId);
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function dbDeleteProject(projectId: string): void {
  const db = getDb();
  db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
}

/**
 * Bulk-sync the full project and thread lists from the renderer store.
 * Uses a transaction for atomicity — either everything writes or nothing.
 */
export function dbSyncAll(projectsData: Project[], threadsData: Thread[], viewJson: string): void {
  if (!_sqlite) throw new Error("Database not initialized");
  const db = getDb();

  _sqlite.transaction(() => {
    // Sync projects
    const existingProjectIds = new Set(
      db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .all()
        .map((r) => r.id),
    );
    const incomingProjectIds = new Set(projectsData.map((p) => p.id));

    for (const pid of existingProjectIds) {
      if (!incomingProjectIds.has(pid)) {
        db.delete(schema.projects).where(eq(schema.projects.id, pid)).run();
      }
    }
    for (let i = 0; i < projectsData.length; i++) {
      dbUpsertProject(projectsData[i]!, i);
    }

    // Sync threads
    const existingThreadIds = new Set(
      db
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .all()
        .map((r) => r.id),
    );
    const incomingThreadIds = new Set(threadsData.map((t) => t.id));

    for (const tid of existingThreadIds) {
      if (!incomingThreadIds.has(tid)) {
        db.delete(schema.threads).where(eq(schema.threads.id, tid)).run();
      }
    }
    for (let i = 0; i < threadsData.length; i++) {
      dbUpsertThread(threadsData[i]!, i);
    }

    // Sync view
    dbSetState("view", viewJson);
  })();
}
