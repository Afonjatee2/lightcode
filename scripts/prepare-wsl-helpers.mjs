/**
 * Stages every Node helper that we run *inside* a WSL distro into
 * `resources/wsl-helpers/` so electron-builder can bundle them as
 * extraResources. Two consumers ride this pipeline today:
 *
 *   1. Git/file watcher:
 *        - `watcher.node` — @parcel/watcher Linux x64 native binding,
 *          downloaded via `npm pack` (no .npmrc / platform override needed)
 *        - `wsl-watcher.cjs` — committed in this repo; no build action needed
 *          beyond ensuring the dest dir exists
 *
 *   2. CLI hook bridge:
 *        - `bridge.mjs` — copied from the canonical source at
 *          `src/supervisor/wsl/bridge/bridge.mjs`
 *
 * The script is idempotent: presence + non-zero size on `watcher.node` skips
 * the download, and `bridge.mjs` is only re-copied when missing or stale
 * (size/mtime mismatch).
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PARCEL_WATCHER_PKG = "@parcel/watcher-linux-x64-glibc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const destDir = join(repoRoot, "resources", "wsl-helpers");

mkdirSync(destDir, { recursive: true });

stageWatcherBinary();
stageHookBridge();

function stageWatcherBinary() {
  const dest = join(destDir, "watcher.node");
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log("[prepare-wsl-helpers] watcher.node already present, skipping");
    return;
  }

  const tmp = join(tmpdir(), `wsl-helpers-watcher-${Date.now()}`);
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
    console.log(`[prepare-wsl-helpers] ${PARCEL_WATCHER_PKG} -> ${dest}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function stageHookBridge() {
  const src = join(repoRoot, "src", "supervisor", "wsl", "bridge", "bridge.mjs");
  if (!existsSync(src)) {
    throw new Error(`hook bridge source missing: ${src}`);
  }
  const dest = join(destDir, "bridge.mjs");
  if (existsSync(dest)) {
    const sourceStat = statSync(src);
    const destStat = statSync(dest);
    if (sourceStat.size === destStat.size && sourceStat.mtimeMs <= destStat.mtimeMs) {
      console.log("[prepare-wsl-helpers] bridge.mjs up to date, skipping");
      return;
    }
  }
  copyFileSync(src, dest);
  console.log(`[prepare-wsl-helpers] bridge.mjs -> ${dest}`);
}
