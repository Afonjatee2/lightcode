import type { ProjectLocation } from "@/shared/contracts";
import { resolveWslExecutablePath } from "./base";

// Single process-wide cache, keyed by `${distro}\0${binary}`.
// Replaces per-adapter `detectedWslExecPaths` maps so detection probes and
// launch spec resolution share one cache instead of five.
const cache = new Map<string, string | undefined>();

function keyOf(distro: string, binary: string): string {
  return `${distro}\0${binary}`;
}

/**
 * Resolve the absolute path of a CLI binary inside the WSL distro tied to the
 * given location. Returns undefined for non-WSL locations (windows/posix rely
 * on PATH lookup at spawn time via the shell).
 */
export function resolveAgentBinaryPath(
  location: ProjectLocation,
  binary: string,
): string | undefined {
  if (location.kind !== "wsl") {
    return undefined;
  }
  const key = keyOf(location.distro, binary);
  if (cache.has(key)) {
    return cache.get(key);
  }
  const resolved = resolveWslExecutablePath(location.distro, binary);
  cache.set(key, resolved);
  return resolved;
}

/**
 * Populate the cache directly. Install detection already runs `command -v`
 * as part of its probe — calling this avoids a second probe at launch time.
 */
export function primeAgentBinaryPath(
  distro: string,
  binary: string,
  path: string | undefined,
): void {
  cache.set(keyOf(distro, binary), path);
}

export function clearAgentBinaryPathCache(): void {
  cache.clear();
}
