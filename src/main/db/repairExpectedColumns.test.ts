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

  it("is a no-op when every expected column already exists", () => {
    sqlite.exec(
      "CREATE TABLE projects (id TEXT PRIMARY KEY, campaign_group_id TEXT, purpose TEXT, campaign_extension TEXT)",
    );
    expect(repairExpectedColumns(sqlite)).toEqual([]);
  });

  it("skips tables that do not exist yet", () => {
    expect(() => repairExpectedColumns(sqlite)).not.toThrow();
  });
});
