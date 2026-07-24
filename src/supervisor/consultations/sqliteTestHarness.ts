import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, initDatabase } from "@/main/db/connection";

/**
 * Test-only harness for running the consultation persistence against a REAL
 * temporary SQLite DB (the full initDatabase migration ladder runs). Mirrors the
 * robust binding probe in projectsThreads.test.ts: better-sqlite3 is normally
 * built for Electron's ABI, so we fall back to the Node-ABI server binding and
 * prepare it on demand rather than silently skipping.
 */
const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");

function databaseOpens(nativeBinding?: string): boolean {
  if (nativeBinding && !existsSync(nativeBinding)) return false;
  try {
    const database = nativeBinding
      ? new Database(":memory:", { nativeBinding })
      : new Database(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
}

function probeSqlite(): { available: boolean; binding: string | undefined } {
  if (databaseOpens()) return { available: true, binding: undefined };
  if (!databaseOpens(serverNativeBinding)) {
    try {
      execFileSync(process.execPath, [join(process.cwd(), "scripts", "prepare-server-native.mjs")], {
        stdio: "inherit",
      });
    } catch {
      return { available: false, binding: undefined };
    }
  }
  if (databaseOpens(serverNativeBinding)) return { available: true, binding: serverNativeBinding };
  return { available: false, binding: undefined };
}

const probed = probeSqlite();
export const sqliteAvailable = probed.available;
const nativeBindingEnv = probed.binding;

export function setupTempDb(): string {
  if (nativeBindingEnv) {
    process.env.PORACODE_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
  }
  const dir = mkdtempSync(join(tmpdir(), "lc-consult-test-"));
  initDatabase(join(dir, "state.sqlite"));
  return dir;
}

export function teardownTempDb(dir: string): void {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PORACODE_BETTER_SQLITE3_NATIVE_BINDING;
}
