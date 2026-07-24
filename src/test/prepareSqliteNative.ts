import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

/**
 * Vitest global setup: ensure a usable better-sqlite3 binding exists BEFORE any
 * test file loads. better-sqlite3 is normally built for Electron's ABI, so the
 * Node-ABI server binding (`dist/server-native/better_sqlite3.node`) is the
 * fallback for the real-SQLite test harnesses. Preparing it here — once, in a
 * single process — removes the parallel-worker race that previously made the
 * per-file probes skip the restart-reconciliation suite ("native setup
 * interference"). Idempotent: does nothing when a binding already opens.
 */
export default function prepareSqliteNativeBinding(): void {
  const cwd = process.cwd();
  const opens = (nativeBinding?: string): boolean => {
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
  };

  if (opens()) return;
  const serverNativeBinding = join(cwd, "dist", "server-native", "better_sqlite3.node");
  if (opens(serverNativeBinding)) return;
  try {
    execFileSync(process.execPath, [join(cwd, "scripts", "prepare-server-native.mjs")], {
      stdio: "inherit",
    });
  } catch {
    // The per-file harness probe still reports availability accurately; tests
    // that need real SQLite will skip themselves if no binding could be built.
  }
}
