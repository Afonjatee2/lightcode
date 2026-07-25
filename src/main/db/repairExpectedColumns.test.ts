import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairExpectedColumns } from "./connection";

// Same fallback the sibling migration suites use: the packaged binding is built
// for Electron's ABI, so tests fall back to the Node-ABI server binding.
const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");
const openDb = (path: string): InstanceType<typeof Database> => {
  try {
    return new Database(path);
  } catch {
    return new Database(path, { nativeBinding: serverNativeBinding });
  }
};

describe("repairExpectedColumns", () => {
  let dir: string;
  let sqlite: InstanceType<typeof Database>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "repair-cols-"));
    sqlite = openDb(join(dir, "state.sqlite"));
  });
  afterEach(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds campaign columns a divergent-lineage database is missing", () => {
    // Same shape a build stamped schema_version 30 without campaign_group_id.
    sqlite.exec(
      "CREATE TABLE projects (id TEXT PRIMARY KEY, purpose TEXT, campaign_extension TEXT)",
    );
    const repaired = repairExpectedColumns(sqlite);
    expect(repaired).toContain("projects.campaign_group_id");
    const cols = (sqlite.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("campaign_group_id");
  });

  it("repairs a divergent thread_summaries table, including NOT NULL columns with data present", () => {
    // The real incident: a divergent build created thread_summaries without the
    // summariser columns, stamped schema_version 30, and every consultation
    // failed with "table thread_summaries has no column named source_cursor".
    sqlite.exec(
      "CREATE TABLE thread_summaries (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    sqlite
      .prepare("INSERT INTO thread_summaries (id, thread_id, summary, created_at) VALUES (?,?,?,?)")
      .run("s1", "t1", "old summary", "2026-01-01T00:00:00Z");

    const repaired = repairExpectedColumns(sqlite);
    expect(repaired).toEqual(
      expect.arrayContaining([
        "thread_summaries.source_cursor",
        "thread_summaries.provider",
        "thread_summaries.model",
        "thread_summaries.content_hash",
      ]),
    );
    // Existing row backfilled so NOT NULL holds; full-shape insert now works.
    const old = sqlite
      .prepare("SELECT source_cursor FROM thread_summaries WHERE id = 's1'")
      .get() as { source_cursor: string };
    expect(old.source_cursor).toBe("");
    sqlite
      .prepare(
        "INSERT INTO thread_summaries (id, thread_id, summary, source_cursor, provider, model, content_hash, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run("s2", "t1", "new", "cursor", "claude", "m", "hash", "2026-01-02T00:00:00Z");
  });

  it("uses the declared default when backfilling NOT NULL columns that have one", () => {
    sqlite.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO projects (id, name) VALUES ('p1', 'P')").run();
    const repaired = repairExpectedColumns(sqlite);
    expect(repaired).toContain("projects.sort_order");
    const row = sqlite
      .prepare("SELECT sort_order, disabled FROM projects WHERE id = 'p1'")
      .get() as {
      sort_order: number;
      disabled: number;
    };
    expect(row.sort_order).toBe(0);
    expect(row.disabled).toBe(0);
  });

  it("rebuilds a table whose divergent extra NOT NULL columns block all inserts", () => {
    // The second half of the real incident: the divergent build's
    // thread_summaries also carried extra NOT NULL columns (through_message_id,
    // generated_by) that current code never writes, so even after adding the
    // missing columns every insert still failed.
    sqlite.exec(
      "CREATE TABLE thread_summaries (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, summary TEXT NOT NULL, through_message_id TEXT NOT NULL, generated_by TEXT NOT NULL, decisions TEXT, created_at TEXT NOT NULL)",
    );
    sqlite
      .prepare(
        "INSERT INTO thread_summaries (id, thread_id, summary, through_message_id, generated_by, created_at) VALUES ('s1','t1','old','m9','claude','2026-01-01T00:00:00Z')",
      )
      .run();

    const repaired = repairExpectedColumns(sqlite);
    expect(repaired).toContain("thread_summaries (rebuilt to canonical shape)");
    // Shared columns survived the rebuild; divergent extras are gone.
    const row = sqlite
      .prepare("SELECT id, thread_id, summary, source_cursor FROM thread_summaries WHERE id='s1'")
      .get() as { summary: string; source_cursor: string };
    expect(row.summary).toBe("old");
    expect(row.source_cursor).toBe("");
    const cols = (
      sqlite.prepare("PRAGMA table_info(thread_summaries)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).not.toContain("through_message_id");
    // The canonical insert shape now works.
    sqlite
      .prepare(
        "INSERT INTO thread_summaries (id, thread_id, summary, source_cursor, provider, model, content_hash, created_at) VALUES ('s2','t1','new','c','p','m','h','2026-01-02T00:00:00Z')",
      )
      .run();
    expect(repairExpectedColumns(sqlite)).toEqual([]);
  });

  it("refuses to rebuild a table that declares foreign keys and repairs columns instead", () => {
    // thread_runtime_items references threads; rebuilding would drop the FK
    // cascade, so the broken extra is surfaced but left in place.
    sqlite.exec(
      "CREATE TABLE thread_runtime_items (thread_id TEXT NOT NULL, item_id TEXT NOT NULL, position INTEGER NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, payload TEXT, streams TEXT, divergent_extra TEXT NOT NULL, PRIMARY KEY (thread_id, item_id))",
    );
    const repaired = repairExpectedColumns(sqlite);
    expect(repaired).toContain("thread_runtime_items.parent_item_id");
    const cols = (
      sqlite.prepare("PRAGMA table_info(thread_runtime_items)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("divergent_extra");
  });

  it("is idempotent — a second pass repairs nothing", () => {
    sqlite.exec(
      "CREATE TABLE thread_summaries (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    expect(repairExpectedColumns(sqlite).length).toBeGreaterThan(0);
    expect(repairExpectedColumns(sqlite)).toEqual([]);
  });

  it("skips tables that do not exist yet", () => {
    expect(() => repairExpectedColumns(sqlite)).not.toThrow();
    expect(repairExpectedColumns(sqlite)).toEqual([]);
  });
});
