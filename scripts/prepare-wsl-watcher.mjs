/**
 * Downloads the @parcel/watcher Linux x64 native binary and copies it into
 * resources/wsl-watcher/ so electron-builder can bundle it as an extra resource.
 *
 * Uses `npm pack` to fetch the tarball directly — no .npmrc or platform overrides needed.
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PARCEL_WATCHER_PKG = "@parcel/watcher-linux-x64-glibc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const destDir = join(__dirname, "..", "resources", "wsl-watcher");
const dest = join(destDir, "watcher.node");

if (existsSync(dest) && statSync(dest).size > 0) {
  console.log("[prepare-wsl-watcher] watcher.node already present, skipping");
  process.exit(0);
}

const tmp = join(tmpdir(), `wsl-watcher-${Date.now()}`);
mkdirSync(destDir, { recursive: true });
mkdirSync(tmp, { recursive: true });

try {
  execSync(`npm pack ${PARCEL_WATCHER_PKG} --pack-destination .`, {
    cwd: tmp,
    stdio: "pipe",
  });

  const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  if (!tgz) {
    throw new Error(`Failed to download ${PARCEL_WATCHER_PKG}`);
  }

  execSync(`tar -xf "${tgz}"`, { cwd: tmp, stdio: "pipe" });

  const src = join(tmp, "package", "watcher.node");
  if (!existsSync(src)) {
    throw new Error("watcher.node not found in extracted package");
  }

  copyFileSync(src, dest);
  console.log(`[prepare-wsl-watcher] ${PARCEL_WATCHER_PKG} -> ${dest}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
