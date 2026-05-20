/**
 * Shared helper for injecting the Lightcode in-app browser MCP server into
 * agent CLIs. The main process hosts a single Streamable-HTTP MCP endpoint
 * (BrowserMcpIngress); each agent receives a URL + bearer token at launch.
 * No per-thread Node child process.
 *
 * Each provider adapter calls one of these functions to assemble the
 * provider-native config (Claude SDK `mcpServers` http entry, Codex `-c`
 * overrides, Gemini `mcpServers` httpUrl, OpenCode `mcp` remote, ACP
 * `mcpServers` http variant).
 */

import { readFileSync, statSync } from "node:fs";
import type { ProjectLocation } from "@/shared/contracts";
import { resolveLightcodePaths } from "@/shared/lightcodePaths";
import { normalizeSharedSettings } from "@/shared/settings";
import { rewriteUrlForWsl } from "@/supervisor/wsl/wslHostIp";

/** Minimal shape needed to pick native-vs-WSL - accepts a `ProjectLocation` or
 *  a stripped-down `{ kind, distro? }` so internal installers can call without
 *  fabricating UNC paths. */
export type BrowserMcpLocation =
  | ProjectLocation
  | { kind: "windows" }
  | { kind: "posix" }
  | { kind: "wsl"; distro: string };

export interface BrowserMcpEnv {
  url: string;
  token: string;
}

export function readBrowserMcpEnv(): BrowserMcpEnv | null {
  const url = process.env.LIGHTCODE_BROWSER_MCP_URL;
  const token = process.env.LIGHTCODE_BROWSER_MCP_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

/**
 * Cached value of `browser.mcpEnabled` keyed by `(settingsPath, mtimeMs)`.
 * `resolveBrowserMcpHttpConfig` is hit on every session create / argv build /
 * plugin install — without the cache that's an `existsSync` + `readFileSync`
 * + `JSON.parse` per call.
 */
let mcpEnabledCache: { key: string; value: boolean } | null = null;

function isBrowserMcpEnabled(): boolean {
  const baseDir = process.env.LIGHTCODE_DATA_DIR;
  if (!baseDir) return true;
  const settingsPath = resolveLightcodePaths(baseDir).settingsPath;
  let mtime: number;
  try {
    mtime = statSync(settingsPath).mtimeMs;
  } catch {
    return true;
  }
  const key = `${settingsPath}|${mtime}`;
  if (mcpEnabledCache && mcpEnabledCache.key === key) return mcpEnabledCache.value;
  try {
    const settings = normalizeSharedSettings(JSON.parse(readFileSync(settingsPath, "utf8")));
    mcpEnabledCache = { key, value: settings.browser.mcpEnabled };
    return mcpEnabledCache.value;
  } catch {
    return true;
  }
}

export const BROWSER_MCP_SERVER_NAME = "lightcode_browser";

export interface BrowserMcpHttpConfig {
  /** MCP endpoint URL ready for the given location. WSL -> host gateway IP. */
  url: string;
  /** Authorization bearer token. */
  token: string;
  /** Headers map (always includes Authorization). */
  headers: Record<string, string>;
}

/**
 * Resolve an HTTP MCP server config suitable for the given project location.
 * For native (windows/posix) projects, the loopback URL is returned as-is.
 * For WSL projects, `127.0.0.1` is rewritten to the WSL->host gateway IP
 * resolved from `\\wsl.localhost\<distro>\etc\resolv.conf`.
 *
 * Returns null when the MCP ingress is not running (env vars absent), the
 * browser MCP setting is disabled, or a WSL distro cannot be reached.
 */
export function resolveBrowserMcpHttpConfig(
  location: BrowserMcpLocation,
): BrowserMcpHttpConfig | null {
  const env = readBrowserMcpEnv();
  if (!env) return null;
  if (!isBrowserMcpEnabled()) return null;
  const url = location.kind === "wsl" ? rewriteUrlForWsl(env.url, location.distro) : env.url;
  // Append `/mcp` so the agent hits the Streamable-HTTP endpoint directly.
  const mcpUrl = `${url.replace(/\/$/, "")}/mcp`;
  return {
    url: mcpUrl,
    token: env.token,
    headers: { Authorization: `Bearer ${env.token}` },
  };
}
