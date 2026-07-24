import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, initDatabase } from "@/main/db/connection";
import { dbGetProjects, dbUpsertProject } from "@/main/db/projectsThreads";

/**
 * Verifies the Phase 4 migration ladder produces the correct final schema.
 * Each test seeds a minimal v1 database (only app_state table with schema_version=1),
 * then lets initDatabase create all tables and run all migrations to SCHEMA_VERSION 30.
 */

function seedV1Database(dir: string): void {
  const dbPath = join(dir, "state.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES ('schema_version', '1')`).run();
  db.close();
}

describe("Phase 4 migration ladder v1 → v30", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      try { closeDatabase(); } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("initDatabase creates all expected tables from v1 seed", () => {
    dir = mkdtempSync(join(tmpdir(), "lc-mig-"));
    seedV1Database(dir);
    initDatabase(join(dir, "state.sqlite"));

    const db = new Database(join(dir, "state.sqlite"));
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[]).map((r) => r.name);

    // Core tables
    expect(tables).toContain("projects");
    expect(tables).toContain("threads");
    expect(tables).toContain("app_state");

    // Phase 4 consultation tables (v27)
    expect(tables).toContain("consultations");
    expect(tables).toContain("context_packets");
    expect(tables).toContain("thread_summaries");
    expect(tables).toContain("consultation_results");
    expect(tables).toContain("panel_membership");

    db.close();
    closeDatabase();
  });

  it("campaign columns exist without duplicates after full migration", () => {
    dir = mkdtempSync(join(tmpdir(), "lc-mig-cols-"));
    seedV1Database(dir);
    initDatabase(join(dir, "state.sqlite"));

    const db = new Database(join(dir, "state.sqlite"));
    const projectCols = (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);

    // v28: campaign_group_id
    expect(projectCols).toContain("campaign_group_id");
    // v29: purpose + campaign_extension
    expect(projectCols).toContain("purpose");
    expect(projectCols).toContain("campaign_extension");

    // No duplicate columns
    const colCounts = new Map<string, number>();
    for (const name of projectCols) colCounts.set(name, (colCounts.get(name) ?? 0) + 1);
    for (const [name, count] of colCounts) {
      expect(count, `duplicate column "${name}" in projects`).toBe(1);
    }

    db.close();
    closeDatabase();
  });

  it("panel_completion_rule exists on consultations (v30)", () => {
    dir = mkdtempSync(join(tmpdir(), "lc-mig-v30-"));
    seedV1Database(dir);
    initDatabase(join(dir, "state.sqlite"));

    const db = new Database(join(dir, "state.sqlite"));
    const consultCols = (db.prepare("PRAGMA table_info(consultations)").all() as { name: string }[]).map((c) => c.name);
    expect(consultCols).toContain("panel_completion_rule");
    expect(consultCols.filter((c) => c === "panel_completion_rule").length).toBe(1);

    db.close();
    closeDatabase();
  });

  it("campaignExtension survives restart after full migration", () => {
    dir = mkdtempSync(join(tmpdir(), "lc-mig-survive-"));
    seedV1Database(dir);
    initDatabase(join(dir, "state.sqlite"));

    const project = {
      id: "proj-survive",
      name: "Survival",
      purpose: "campaign" as const,
      campaignExtension: {
        campaignGroupId: "cg-survive-mig",
        clientName: "Survivor Client",
        campaignName: "Survivor Campaign",
        jobNumber: "MIG-999",
        mcpProfile: "deployment" as const,
      },
      location: { kind: "posix" as const, path: "/tmp/survive" },
      createdAt: new Date().toISOString(),
    };
    dbUpsertProject(project, 0);

    // Simulate restart
    closeDatabase();
    initDatabase(join(dir, "state.sqlite"));

    const found = dbGetProjects().find((p) => p.id === "proj-survive");
    expect(found).toBeDefined();
    expect(found?.purpose).toBe("campaign");
    expect(found?.campaignExtension?.campaignGroupId).toBe("cg-survive-mig");
    expect(found?.campaignExtension?.jobNumber).toBe("MIG-999");
    expect(found?.campaignExtension?.mcpProfile).toBe("deployment");

    closeDatabase();
  });
});
