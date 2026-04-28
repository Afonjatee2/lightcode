#!/usr/bin/env node
/**
 * Release-prep helper: fetches the official SHASUMS256.txt for the pinned
 * Node.js LTS version and writes the relevant rows into
 * `src/supervisor/wsl/runtime/index.ts`.
 *
 * Run after bumping `LIGHTCODE_PINNED_NODE_VERSION` in that file:
 *
 *   pnpm tsx scripts/refresh-node-checksums.mjs
 *
 * Only the official glibc tarballs (linux-x64, linux-arm64) are tracked;
 * Alpine/musl users are expected to surface their own node via the probe
 * (the resolver's first path) or install it via `apk add nodejs`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const indexFile = join(repoRoot, "src", "supervisor", "wsl", "runtime", "index.ts");

const TARGETS = /** @type {const} */ ([
  { triple: "linux-x64", source: "official" },
  { triple: "linux-arm64", source: "official" },
]);

function readPinnedVersion() {
  const src = readFileSync(indexFile, "utf8");
  const match = /LIGHTCODE_PINNED_NODE_VERSION\s*=\s*"([^"]+)"/.exec(src);
  if (!match) {
    throw new Error(
      `could not find LIGHTCODE_PINNED_NODE_VERSION in ${indexFile} — has the constant been renamed?`,
    );
  }
  return match[1];
}

async function fetchOfficialManifest(version) {
  const url = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.text();
}

function parseManifest(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // SHASUMS256.txt format: "<sha256>  <filename>" (two spaces).
    const m = /^([0-9a-f]{64})\s+(.+)$/i.exec(trimmed);
    if (m) map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

function archiveFileName(version, triple) {
  return `node-v${version}-${triple}.tar.xz`;
}

async function main() {
  const version = readPinnedVersion();
  console.log(`refreshing Node tarball checksums for v${version}`);

  const manifest = parseManifest(await fetchOfficialManifest(version));

  const newChecksums = {};
  for (const { triple } of TARGETS) {
    const filename = archiveFileName(version, triple);
    const sha = manifest.get(filename);
    if (!sha) {
      throw new Error(
        `${filename} not found in official SHASUMS256.txt for v${version}; ` +
          `the version may not have a complete release set yet`,
      );
    }
    newChecksums[triple] = sha;
    console.log(`  ${triple.padEnd(20)} ${sha}`);
  }

  let src = readFileSync(indexFile, "utf8");
  const startMarker = "export const NODE_TARBALL_CHECKSUMS: Record<NodeTargetTriple, string> = {";
  const endMarker = "};";
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(`could not find ${startMarker} in ${indexFile}`);
  }
  const blockEndIdx = src.indexOf(endMarker, startIdx);
  if (blockEndIdx < 0) {
    throw new Error(`could not find closing brace of NODE_TARBALL_CHECKSUMS`);
  }

  const lines = [
    startMarker,
    ...TARGETS.map(({ triple }) => {
      const filename = archiveFileName(version, triple);
      return `  // ${filename}\n  "${triple}": "${newChecksums[triple]}",`;
    }),
  ];
  const replacement = `${lines.join("\n")}\n${endMarker}`;
  src = `${src.slice(0, startIdx)}${replacement}${src.slice(blockEndIdx + endMarker.length)}`;
  writeFileSync(indexFile, src, "utf8");

  console.log(`updated ${indexFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
