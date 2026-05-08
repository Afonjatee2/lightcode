// Clones the production Lightcode SQLite DB into the dev base dir so dev runs
// start from real data. One-way (prod -> dev) by design; never the reverse.
//
// Source: ~/.lightcode/state.sqlite
// Dest:   ~/.lightcode-dev/state.sqlite
//
// Uses better-sqlite3's online backup API so it is safe to run while the
// production app is open (no WAL/SHM corruption). The dev DB is overwritten.

import { homedir } from "node:os";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const srcDir = join(homedir(), ".lightcode");
const destDir = join(homedir(), ".lightcode-dev");
const srcPath = join(srcDir, "state.sqlite");
const destPath = join(destDir, "state.sqlite");

if (!existsSync(srcPath)) {
  console.error(`[clone-db] Source DB not found: ${srcPath}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

for (const path of [destPath, `${destPath}-wal`, `${destPath}-shm`]) {
  if (existsSync(path)) rmSync(path, { force: true });
}

const src = new Database(srcPath, { readonly: true, fileMustExist: true });
try {
  console.log(`[clone-db] ${srcPath}`);
  console.log(`[clone-db]   -> ${destPath}`);
  await src.backup(destPath);
  const { size } = statSync(destPath);
  console.log(`[clone-db] Done (${(size / 1024 / 1024).toFixed(2)} MiB)`);
} finally {
  src.close();
}
