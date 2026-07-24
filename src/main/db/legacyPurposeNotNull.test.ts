import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, initDatabase } from "@/main/db/connection";
import { dbGetProjects, dbUpsertProject } from "@/main/db/projectsThreads";

/**
 * Databases stamped by older builds declare projects.purpose as
 * NOT NULL DEFAULT 'code'. SQLite does not apply a column default to an
 * explicitly supplied NULL, so writing NULL there fails — and because
 * dbSyncAll deletes before it re-inserts, that failure emptied the projects
 * table on launch.
 */
describe("legacy NOT NULL projects.purpose", () => {
  let dir: string;
  let dbPath: string;

  // Same fallback the sibling migration suites use: the packaged binding is
  // built for Electron's ABI, so tests fall back to the Node-ABI server build.
  const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");
  const nativeBindingEnv = existsSync(serverNativeBinding) ? serverNativeBinding : undefined;
  const openDb = (path: string): InstanceType<typeof Database> => {
    try {
      return new Database(path);
    } catch {
      return new Database(path, { nativeBinding: serverNativeBinding });
    }
  };
  const withNativeBinding = <T>(fn: () => T): T => {
    if (nativeBindingEnv) process.env.PORACODE_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    try {
      return fn();
    } finally {
      delete process.env.PORACODE_BETTER_SQLITE3_NATIVE_BINDING;
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "legacy-purpose-"));
    dbPath = join(dir, "state.sqlite");
    const seed = openDb(dbPath);
    seed.exec(`
      CREATE TABLE projects (
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
        disabled INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      , search_settings TEXT, purpose TEXT NOT NULL DEFAULT 'code', campaign_extension TEXT, campaign_group_id TEXT);
      CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO app_state (key, value) VALUES ('schema_version', '30');
    `);
    seed.close();
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists a project that carries no purpose without violating the constraint", () => {
    withNativeBinding(() => initDatabase(dbPath));
    expect(() =>
      withNativeBinding(() =>
        dbUpsertProject(
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Legacy project",
            location: { kind: "posix", path: "/tmp/legacy" },
            createdAt: new Date().toISOString(),
          },
          0,
        ),
      ),
    ).not.toThrow();

    const projects = withNativeBinding(() => dbGetProjects());
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("Legacy project");
  });
});
