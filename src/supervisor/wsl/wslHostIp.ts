import { readFileSync } from "node:fs";

/**
 * Resolve the Windows-host IP as seen from inside the given WSL distro.
 *
 * WSL2 puts the host's loopback behind a gateway: the distro's
 * `/etc/resolv.conf` first nameserver line is the gateway IP. We read that
 * via the `\\wsl.localhost\<distro>\etc\resolv.conf` UNC path (Node's `fs`
 * reads UNC paths natively — no `wsl.exe` round-trip needed).
 *
 * Returns null when the distro is unreachable, resolv.conf is missing, or
 * the file doesn't expose a usable nameserver. Callers should fall back to
 * `127.0.0.1` (which still works for native projects).
 */
const cache = new Map<
  string,
  { ip: string; capturedAt: number } | { ip: null; capturedAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function resolveWslHostIp(distro: string): string | null {
  if (!distro) return null;
  const cached = cache.get(distro);
  if (cached && Date.now() - cached.capturedAt < CACHE_TTL_MS) {
    return cached.ip;
  }
  let raw: string;
  try {
    raw = readFileSync(`\\\\wsl.localhost\\${distro}\\etc\\resolv.conf`, "utf8");
  } catch {
    cache.set(distro, { ip: null, capturedAt: Date.now() });
    return null;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*nameserver\s+(\S+)\s*$/);
    if (m && m[1] && m[1] !== "127.0.0.1" && m[1] !== "::1") {
      cache.set(distro, { ip: m[1], capturedAt: Date.now() });
      return m[1];
    }
  }
  cache.set(distro, { ip: null, capturedAt: Date.now() });
  return null;
}

export function rewriteUrlForWsl(url: string, distro: string): string {
  if (!distro) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    return url;
  }
  const ip = resolveWslHostIp(distro);
  if (!ip) return url;
  parsed.hostname = ip;
  return parsed.toString().replace(/\/$/, "");
}

/** Test helper. */
export function __clearWslHostIpCache(): void {
  cache.clear();
}
