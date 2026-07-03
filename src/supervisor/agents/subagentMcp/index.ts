/**
 * Shared helper for injecting the Lightcode cross-provider subagents MCP server
 * into agent runtimes. The supervisor hosts a single in-process Streamable-HTTP
 * MCP endpoint (`SubagentMcpIngress`); each thread that opts in receives a URL +
 * per-thread bearer token at launch so the agent can discover and spawn the
 * other connected agents as subagents.
 *
 * Mirrors the `browserMcp` module shape. Each provider adapter (phase 2) reads
 * `CreateStructuredSessionInput.subagentMcp` / `AgentLaunchOptions.subagentMcp`
 * and assembles its provider-native MCP config (Claude SDK `mcpServers` http
 * entry, Codex `-c` overrides, Gemini `mcpServers` httpUrl, OpenCode `mcp`
 * remote, ACP `mcpServers` http variant).
 *
 * WSL reachability: unlike the browser MCP — which tunnels through the in-WSL
 * `bridge.mjs` reverse proxy (its `/mcp` route is hard-wired to the browser
 * upstream with a fixed env token) — the subagents ingress uses PER-THREAD
 * bearer tokens that can't be baked into a shared per-distro proxy. Instead we
 * mirror `BrowserMcpIngress`'s network posture: the supervisor ingress binds
 * `0.0.0.0` on Windows so an agent inside a WSL distro can reach the host over
 * the WSL2 NAT gateway IP (loopback inside the distro can't hit the host's
 * `127.0.0.1`). At launch we rewrite the loopback URL host to that gateway IP.
 * The per-thread bearer token stays the security boundary — see
 * `resolveSubagentMcpHttpConfigForLaunch` and `SubagentMcpIngress.start`.
 */

import type { ProjectLocation } from "@/shared/contracts";

export const SUBAGENT_MCP_SERVER_NAME = "subagents";

export interface SubagentMcpHttpConfig {
  /** MCP endpoint URL (already suffixed with `/mcp`). */
  url: string;
  /** Per-thread authorization bearer token. */
  token: string;
  /** Headers map (always includes `Authorization`). */
  headers: Record<string, string>;
}

/** Minimal shape needed to pick native-vs-WSL — accepts a `ProjectLocation` or
 *  a stripped-down `{ kind, distro? }` so internal callers don't fabricate UNC
 *  paths. Mirrors `BrowserMcpLocation`. */
export type SubagentMcpLocation =
  | ProjectLocation
  | { kind: "windows" }
  | { kind: "posix" }
  | { kind: "wsl"; distro: string };

/**
 * Host-side resolver for the WSL → host gateway IP of a distro. Implemented in
 * the supervisor wiring (Windows-only; reads `nameserver` from
 * `\\wsl.localhost\<distro>\etc\resolv.conf`). Returns `undefined` when it
 * can't be determined (non-Windows host, distro unreachable) so the caller can
 * fall back to "not available".
 */
export interface SubagentMcpHostGatewayResolver {
  resolveHostGatewayIp(distro: string): string | undefined;
}

/**
 * Resolve the subagents MCP http config for a given project location.
 *
 * - Native (windows/posix): the native loopback config is returned unchanged.
 * - WSL: the loopback host in `native.url` is rewritten to the WSL → host
 *   gateway IP so the in-distro agent can reach the `0.0.0.0`-bound ingress.
 *   The per-thread token + headers are preserved verbatim.
 *
 * Returns `undefined` when the thread hasn't registered (`native` absent), or —
 * for WSL — when no gateway resolver is wired or the gateway IP can't be
 * resolved. This mirrors the browser helper's "no bridge → undefined" fallback:
 * we never hand a WSL agent an unreachable `127.0.0.1` URL.
 */
export function resolveSubagentMcpHttpConfigForLaunch(
  native: SubagentMcpHttpConfig | undefined,
  location: SubagentMcpLocation,
  hostGateway?: SubagentMcpHostGatewayResolver,
): SubagentMcpHttpConfig | undefined {
  if (!native) return undefined;
  if (location.kind !== "wsl") return native;
  if (!hostGateway) return undefined;
  const ip = hostGateway.resolveHostGatewayIp(location.distro);
  if (!ip) return undefined;
  const url = rewriteLoopbackHost(native.url, ip);
  if (!url) return undefined;
  return { url, token: native.token, headers: native.headers };
}

/** Rewrite a loopback URL's host to `ip`, preserving port + path. Non-loopback
 *  hosts pass through untouched. Returns `undefined` on an unparseable URL. */
function rewriteLoopbackHost(rawUrl: string, ip: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname === "::1"
  ) {
    parsed.hostname = ip;
  }
  return parsed.toString();
}
