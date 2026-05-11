import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const VERSION_FILES = [".nvmrc", ".node-version"] as const;
const MAX_WALK_DEPTH = 32;

const cache = new Map<string, string | null>();

export function clearProjectNodeBinCache(): void {
  cache.clear();
}

/**
 * Resolve the Node bin directory pinned by a project via `.nvmrc` /
 * `.node-version`, mapped against the user's nvm install. Returns
 * `undefined` when no version file is found, the requested version
 * is uninstalled, or NVM_DIR is missing.
 *
 * Why: the supervisor primes its PATH from a login shell launched at
 * `$HOME`, so it carries the user's default Node — not the project's
 * pinned version. Agents launched in a project that pins Node 24 would
 * otherwise inherit the home-shell Node when shelling out to npx/node.
 *
 * How to apply: callers prepend the returned bin path to `PATH` for
 * agent spawns whose cwd is inside the project. Walks up from `cwd`
 * (mirroring nvm) so subdirectories pick up the root's version file.
 */
export function resolveProjectNodeBin(cwd: string, nvmDir?: string): string | undefined {
  const cached = cache.get(cwd);
  if (cached !== undefined) return cached ?? undefined;

  const result = compute(cwd, nvmDir);
  cache.set(cwd, result ?? null);
  return result;
}

function compute(cwd: string, nvmDirOverride?: string): string | undefined {
  const versionFile = findVersionFile(cwd);
  if (!versionFile) return undefined;
  const requested = readVersion(versionFile);
  if (!requested) return undefined;

  const nvmDir = nvmDirOverride || process.env.NVM_DIR || join(homedir(), ".nvm");
  const versionsRoot = join(nvmDir, "versions", "node");
  if (!existsSync(versionsRoot)) return undefined;

  const matched = pickMatchingVersion(versionsRoot, requested);
  if (!matched) return undefined;

  const bin = join(versionsRoot, matched, "bin");
  return existsSync(bin) ? bin : undefined;
}

function findVersionFile(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    for (const name of VERSION_FILES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (!parent || parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function readVersion(file: string): string | undefined {
  try {
    const raw = readFileSync(file, "utf8");
    const line = raw
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("#"));
    if (!line) return undefined;
    return line
      .replace(/^node-?/i, "")
      .replace(/^v/i, "")
      .trim();
  } catch {
    return undefined;
  }
}

type SemverParts = readonly [number, number, number];

function pickMatchingVersion(versionsRoot: string, requested: string): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(versionsRoot).filter((name) => name.startsWith("v"));
  } catch {
    return undefined;
  }

  const installed = entries
    .map((name) => ({ name, parts: parseSemver(name.slice(1)) }))
    .filter((e): e is { name: string; parts: SemverParts } => e.parts !== null)
    .sort((a, b) => compareParts(b.parts, a.parts));

  if (installed.length === 0) return undefined;

  // Aliases (`lts/iron`, `stable`, `node`, etc.) — without nvm's alias map,
  // the safest fallback is the highest installed version.
  if (/^[a-z]/i.test(requested)) return installed[0]!.name;

  const reqParts = parseSemver(requested);
  if (!reqParts) return installed[0]!.name;

  const requestedFields = requested.split(".").length;
  const exact = installed.find((e) => {
    if (e.parts[0] !== reqParts[0]) return false;
    if (requestedFields >= 2 && e.parts[1] !== reqParts[1]) return false;
    if (requestedFields >= 3 && e.parts[2] !== reqParts[2]) return false;
    return true;
  });
  return exact?.name;
}

function parseSemver(raw: string): SemverParts | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function compareParts(a: SemverParts, b: SemverParts): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}
