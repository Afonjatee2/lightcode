/**
 * WSL Node runtime resolver.
 *
 * Single entry point for "give me an absolute path to a usable Node binary
 * inside <distro>". Two paths:
 *
 *   1. Probe the user's login shell for an existing `node`. If it resolves
 *      to a binary at version >= MIN_ACCEPTED_NODE_MAJOR, use it. Re-probed
 *      every supervisor boot so nvm version changes are picked up.
 *
 *   2. If no acceptable node is found, download the pinned LTS Node tarball
 *      from nodejs.org (or unofficial-builds.nodejs.org for musl distros),
 *      verify SHA256, stage it via `\\wsl.localhost\` UNC, and extract
 *      inside the distro using its own `tar`.
 *
 * In both cases the returned `nodePath` is an absolute Linux path baked
 * into hook commands and the bridge launch argv. /bin/sh -c never needs
 * to resolve `node` from PATH.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { toWslUncPath } from "@/shared/wsl";
import { batchWslCommandsAsync, getWslCommand, resolveWslHomeDirectory } from "../../agents/base";

// ── Pinned Node version + checksums ──────────────────────────────────────

/**
 * Pinned Node LTS version that the runtime installer downloads when the
 * user's distro doesn't have an acceptable node. Bumped manually with new
 * LTS releases. Keep in lockstep with `MIN_ACCEPTED_NODE_MAJOR`.
 *
 * When bumping: run `pnpm tsx scripts/refresh-node-checksums.mjs` to update
 * `NODE_TARBALL_CHECKSUMS` from nodejs.org's official SHASUMS256.txt.
 */
export const LIGHTCODE_PINNED_NODE_VERSION = "22.11.0";

/**
 * Minimum Node major version we accept from the user's distro. Below this,
 * we download our own. Same major as `LIGHTCODE_PINNED_NODE_VERSION` so
 * we have a single supported version line for testing/debugging.
 */
export const MIN_ACCEPTED_NODE_MAJOR = 22;

export type LinuxArch = "x64" | "arm64";
export type NodeTargetTriple = "linux-x64" | "linux-arm64";

/**
 * SHA256 checksums for the pinned Node tarballs from the official
 * nodejs.org SHASUMS256.txt. Updated by `scripts/refresh-node-checksums.mjs`.
 *
 * Only glibc tarballs are tracked; musl distros (Alpine) are expected to
 * have node available via probe (the user's `apk add nodejs` install).
 * If a checksum is empty, install fails loudly — refresh after bumping
 * `LIGHTCODE_PINNED_NODE_VERSION`.
 */
export const NODE_TARBALL_CHECKSUMS: Record<NodeTargetTriple, string> = {
  // node-v22.11.0-linux-x64.tar.xz
  "linux-x64": "83bf07dd343002a26211cf1fcd46a9d9534219aad42ee02847816940bf610a72",
  // node-v22.11.0-linux-arm64.tar.xz
  "linux-arm64": "6031d04b98f59ff0f7cb98566f65b115ecd893d3b7870821171708cdbaf7ae6e",
};

// ── Cache ────────────────────────────────────────────────────────────────

export interface ResolvedNode {
  /** Absolute Linux path to the node binary inside the distro. */
  nodePath: string;
  /** Version string, e.g. "22.11.0". */
  nodeVersion: string;
  /** Whether we found the user's node or installed our own. */
  source: "user-installed" | "lightcode-managed";
}

/**
 * In-memory cache, keyed by distro name. Cleared on supervisor restart so
 * users picking up a new nvm default get re-probed without manual action.
 */
const distroNodeCache = new Map<string, ResolvedNode>();

// ── Progress reporting ───────────────────────────────────────────────────

export type RuntimeProgressEvent =
  | { kind: "probe-start" }
  | { kind: "probe-result"; resolved: "found" | "missing" | "too-old"; version?: string }
  | {
      kind: "download-start";
      url: string;
      target: NodeTargetTriple;
      sizeBytes?: number;
    }
  | { kind: "download-progress"; bytesReceived: number; bytesTotal: number }
  | { kind: "verify-start" }
  | { kind: "extract-start" }
  | { kind: "ready"; nodePath: string };

export type RuntimeProgressListener = (event: RuntimeProgressEvent) => void;

export interface ResolveNodeOptions {
  onProgress?: RuntimeProgressListener;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Resolve a usable Node binary inside `distro`. Probes once per supervisor
 * lifetime (cheap, ~50ms via login shell); falls back to downloading the
 * pinned LTS if no acceptable node is found.
 */
export async function resolveNodeForDistro(
  distro: string,
  options?: ResolveNodeOptions,
): Promise<ResolvedNode> {
  const cached = distroNodeCache.get(distro);
  if (cached) {
    if (cached.source === "user-installed" || existsSync(toWslUncPath(distro, cached.nodePath))) {
      options?.onProgress?.({ kind: "ready", nodePath: cached.nodePath });
      return cached;
    }
    distroNodeCache.delete(distro);
  }

  options?.onProgress?.({ kind: "probe-start" });
  const probed = await probeUserNode(distro);

  if (probed) {
    const major = parseMajor(probed.version);
    if (major !== null && major >= MIN_ACCEPTED_NODE_MAJOR) {
      options?.onProgress?.({ kind: "probe-result", resolved: "found", version: probed.version });
      const resolved: ResolvedNode = {
        nodePath: probed.nodePath,
        nodeVersion: probed.version,
        source: "user-installed",
      };
      distroNodeCache.set(distro, resolved);
      options?.onProgress?.({ kind: "ready", nodePath: probed.nodePath });
      return resolved;
    }
    options?.onProgress?.({ kind: "probe-result", resolved: "too-old", version: probed.version });
  } else {
    options?.onProgress?.({ kind: "probe-result", resolved: "missing" });
  }

  const installed = await installRuntimeIntoDistro(distro, options);
  const resolved: ResolvedNode = {
    nodePath: installed.nodePath,
    nodeVersion: LIGHTCODE_PINNED_NODE_VERSION,
    source: "lightcode-managed",
  };
  distroNodeCache.set(distro, resolved);
  options?.onProgress?.({ kind: "ready", nodePath: installed.nodePath });
  return resolved;
}

// ── Probe ────────────────────────────────────────────────────────────────

/**
 * Run `command -v node && node --version` through the user's login shell.
 * Login shells source `.bashrc`/`.zshrc` which load nvm/fnm, so this
 * surfaces the user's nvm-default node even when /bin/sh's PATH wouldn't
 * find it. Returns null when no node is found.
 */
export async function probeUserNode(
  distro: string,
): Promise<{ nodePath: string; version: string } | null> {
  const [pathResult, versionResult] = await batchWslCommandsAsync(distro, [
    "command -v node",
    "node --version 2>/dev/null",
  ]);

  const nodePath = (pathResult?.stdout ?? "").trim();
  const versionRaw = (versionResult?.stdout ?? "").trim();
  if (!nodePath || !nodePath.startsWith("/")) return null;
  if (!versionRaw.startsWith("v")) return null;
  const version = versionRaw.slice(1).split(/\s/)[0] ?? "";
  if (!parseMajor(version)) return null;
  return { nodePath, version };
}

async function probeDistroArch(distro: string): Promise<LinuxArch | null> {
  const [archResult] = await batchWslCommandsAsync(distro, ["uname -m"]);
  const out = (archResult?.stdout ?? "").trim();
  if (out === "x86_64" || out === "amd64") return "x64";
  if (out === "aarch64" || out === "arm64") return "arm64";
  return null;
}

// ── Install ──────────────────────────────────────────────────────────────

/**
 * Download and extract the pinned Node tarball into the distro. Throws
 * with a descriptive Error on failure (no arch, no checksum, network
 * failure, archive corruption, etc.). Only the official glibc tarballs
 * are supported here — Alpine/musl users are expected to surface their
 * own node via the probe.
 */
export async function installRuntimeIntoDistro(
  distro: string,
  options?: ResolveNodeOptions,
): Promise<{ nodePath: string }> {
  const arch = await probeDistroArch(distro);
  if (!arch) {
    throw new Error(`could not detect architecture for WSL distro "${distro}"`);
  }
  const target: NodeTargetTriple = `linux-${arch}` as const;

  const checksum = NODE_TARBALL_CHECKSUMS[target];
  if (!checksum) {
    throw new Error(
      `lightcode is missing the SHA256 checksum for Node ${LIGHTCODE_PINNED_NODE_VERSION} ${target}; rerun scripts/refresh-node-checksums.mjs`,
    );
  }

  const home = resolveWslHomeDirectory(distro);
  if (!home) {
    throw new Error(`could not resolve $HOME inside WSL distro "${distro}"`);
  }

  const linuxRuntimeDir = `${home}/.lightcode/runtime`;
  const versionedDirName = nodeArchiveDirName(target);
  const linuxNodePath = `${linuxRuntimeDir}/${versionedDirName}/bin/node`;
  const uncNodePath = toWslUncPath(distro, linuxNodePath);

  if (existsSync(uncNodePath)) {
    return { nodePath: linuxNodePath };
  }

  const tarballName = nodeArchiveFileName(target);
  const url = nodeArchiveUrl(target);

  options?.onProgress?.({ kind: "download-start", url, target });
  const tmpTarball = join(tmpdir(), `lightcode-node-${Date.now()}-${tarballName}`);
  try {
    await downloadToFile(url, tmpTarball, options);
    options?.onProgress?.({ kind: "verify-start" });
    await verifySha256(tmpTarball, checksum);

    // Stage the tarball into the distro via UNC, then ask the distro's
    // own tar to extract it (saves marshalling bytes back through wsl.exe
    // stdin and lets us use tar's xz/strip-components flags directly).
    const uncRuntimeDir = toWslUncPath(distro, linuxRuntimeDir);
    mkdirSync(uncRuntimeDir, { recursive: true });
    const stagedLinuxPath = `${linuxRuntimeDir}/${tarballName}`;
    const stagedUncPath = toWslUncPath(distro, stagedLinuxPath);
    copyFileSync(tmpTarball, stagedUncPath);

    options?.onProgress?.({ kind: "extract-start" });
    await extractInDistro(distro, stagedLinuxPath, linuxRuntimeDir);

    // Drop the staged tarball — we have the extracted tree.
    try {
      rmSync(stagedUncPath);
    } catch {
      // Non-fatal — disk hygiene only.
    }

    if (!existsSync(uncNodePath)) {
      throw new Error(`Node binary not found at expected path after extraction: ${linuxNodePath}`);
    }
    pruneStaleRuntimes(distro, linuxRuntimeDir, versionedDirName);
    return { nodePath: linuxNodePath };
  } finally {
    try {
      rmSync(tmpTarball);
    } catch {
      // Ignore — Windows TMP cleans itself up.
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseMajor(version: string): number | null {
  const match = /^(\d+)\./.exec(version);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function nodeArchiveFileName(target: NodeTargetTriple): string {
  return `node-v${LIGHTCODE_PINNED_NODE_VERSION}-${target}.tar.xz`;
}

function nodeArchiveDirName(target: NodeTargetTriple): string {
  return `node-v${LIGHTCODE_PINNED_NODE_VERSION}-${target}`;
}

function nodeArchiveUrl(target: NodeTargetTriple): string {
  return `https://nodejs.org/dist/v${LIGHTCODE_PINNED_NODE_VERSION}/${nodeArchiveFileName(target)}`;
}

async function downloadToFile(
  url: string,
  destPath: string,
  options?: ResolveNodeOptions,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  if (!response.body) {
    throw new Error(`empty response body for ${url}`);
  }

  const totalHeader = response.headers.get("content-length");
  const bytesTotal = totalHeader ? Number.parseInt(totalHeader, 10) : 0;
  let bytesReceived = 0;
  let lastReport = 0;
  const progressChunkBytes = 262_144;

  mkdirSync(dirname(destPath), { recursive: true });
  const out = createWriteStream(destPath);

  const nodeStream = Readable.fromWeb(
    response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  );
  nodeStream.on("data", (chunk: Buffer | string) => {
    const len = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    bytesReceived += len;
    if (bytesReceived - lastReport >= progressChunkBytes) {
      options?.onProgress?.({ kind: "download-progress", bytesReceived, bytesTotal });
      lastReport = bytesReceived;
    }
  });
  await pipeline(nodeStream, out);
  options?.onProgress?.({
    kind: "download-progress",
    bytesReceived,
    bytesTotal: bytesTotal || bytesReceived,
  });
}

async function verifySha256(filePath: string, expected: string): Promise<void> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  const actual = hash.digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
}

async function extractInDistro(
  distro: string,
  linuxTarballPath: string,
  linuxDestDir: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      getWslCommand(),
      ["-d", distro, "--", "tar", "-xJf", linuxTarballPath, "-C", linuxDestDir],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Best-effort sweep of stale `node-v*` directories that don't match the
 * just-installed runtime. Keeps `~/.lightcode/runtime/` from accumulating
 * ~80 MB per pinned-version bump. Failures are swallowed.
 */
function pruneStaleRuntimes(distro: string, linuxRuntimeDir: string, keepDirName: string): void {
  const uncRuntimeDir = toWslUncPath(distro, linuxRuntimeDir);
  let entries: string[];
  try {
    entries = readdirSync(uncRuntimeDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith("node-v") || entry === keepDirName) continue;
    const target = `${uncRuntimeDir}\\${entry}`;
    try {
      if (statSync(target).isDirectory()) rmSync(target, { recursive: true, force: true });
    } catch {
      // Ignore — best effort.
    }
  }
}
