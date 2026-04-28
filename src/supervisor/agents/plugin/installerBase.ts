import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveLightcodePaths } from "@/shared/lightcodePaths";
import { toWslUncPath } from "@/shared/wsl";
import type { AgentEnvContext } from "../base";
import { resolveWslHomeDirectory } from "../base";

/**
 * Shared plumbing for provider hook plugin installers (claude/codex/gemini).
 * Each provider keeps its hook-event list, settings/hooks document shape, and
 * intent map private; this module only handles the generic plumbing — source
 * resolution, manifest reading, asset copy/freshness, and WSL path math.
 */

export const PLUGIN_ASSET_FILES = ["plugin.json", "forward.mjs"] as const;

export interface PluginManifest {
  version: string;
  [key: string]: unknown;
}

export type WslAgentEnvContext = AgentEnvContext & { envKind: "wsl"; wslDistro: string };

export function isWslPluginContext(ctx: AgentEnvContext | undefined): ctx is WslAgentEnvContext {
  return Boolean(ctx && ctx.envKind === "wsl" && ctx.wslDistro);
}

export interface PluginSourceResolverOptions {
  kind: string;
  /** Env var override for the source dir, e.g. `LIGHTCODE_CLAUDE_PLUGIN_SOURCE`. */
  sourceEnvVar: string;
  /**
   * `__dirname` of the *caller* (the provider's install.ts). Fallback candidate
   * paths are computed relative to this so both bundled and source-checkout
   * layouts resolve correctly.
   */
  callerDir: string;
}

/**
 * Memoized per-call: the first successful resolve is cached for the lifetime
 * of the closure. The `LIGHTCODE_*_PLUGIN_SOURCE` env override is therefore
 * read only on the first call; subsequent env mutations are ignored.
 */
export function createPluginSourceResolver(opts: PluginSourceResolverOptions): () => string {
  let cached: string | undefined;
  return () => {
    if (cached) return cached;
    const candidates: string[] = [];
    const override = process.env[opts.sourceEnvVar];
    if (override) candidates.push(resolve(override));
    if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
      candidates.push(join(process.resourcesPath, "agent-plugins", opts.kind));
    }
    candidates.push(resolve(opts.callerDir));
    candidates.push(resolve(opts.callerDir, `../../../agent-plugins/${opts.kind}`));
    candidates.push(resolve(opts.callerDir, `../../src/supervisor/agents/${opts.kind}/plugin`));
    candidates.push(resolve(opts.callerDir, `../../../src/supervisor/agents/${opts.kind}/plugin`));
    candidates.push(resolve(opts.callerDir, `../../resources/agent-plugins/${opts.kind}`));
    candidates.push(resolve(opts.callerDir, `../resources/agent-plugins/${opts.kind}`));
    for (const candidate of candidates) {
      if (existsSync(join(candidate, "plugin.json"))) {
        cached = candidate;
        return candidate;
      }
    }
    throw new Error(`${opts.kind} plugin source dir not found; checked: ${candidates.join(", ")}`);
  };
}

export function readPluginManifest(dir: string): PluginManifest {
  const raw = readFileSync(join(dir, "plugin.json"), "utf8");
  return JSON.parse(raw) as PluginManifest;
}

export function readBundledPluginVersion(resolveSourceDir: () => string): string {
  try {
    const v = readPluginManifest(resolveSourceDir()).version;
    return typeof v === "string" && v.length > 0 ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function copyPluginAssetFile(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

export function isPluginAssetsFresh(
  sourceDir: string,
  targetDir: string,
  files: readonly string[] = PLUGIN_ASSET_FILES,
): boolean {
  for (const file of files) {
    const source = join(sourceDir, file);
    const target = join(targetDir, file);
    if (!existsSync(target)) return false;
    try {
      const sourceStat = statSync(source);
      const targetStat = statSync(target);
      if (sourceStat.size !== targetStat.size) return false;
      if (sourceStat.mtimeMs > targetStat.mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function copyPluginAssetsIfStale(
  sourceDir: string,
  targetDir: string,
  files: readonly string[] = PLUGIN_ASSET_FILES,
): void {
  if (isPluginAssetsFresh(sourceDir, targetDir, files)) return;
  for (const file of files) {
    copyPluginAssetFile(join(sourceDir, file), join(targetDir, file));
  }
}

/**
 * Quote a path for embedding in a hook command line. POSIX shells and Claude's
 * settings reader want single-quoted; Windows cmd inside a JSON command field
 * wants double-quoted with embedded `"` escaped.
 */
export function quoteHookCommandArg(value: string, target: "native" | "wsl"): string {
  if (target === "native" && process.platform === "win32") {
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export interface WslPluginBaseDirs {
  /** Linux home dir, e.g. `/home/sdsle`. */
  home: string;
  /** Linux-side plugin dir inside the distro. */
  linuxBase: string;
  /** Windows UNC path to that Linux plugin dir, for `fs.*` access from Win32. */
  uncBase: string;
}

export function getWslPluginBaseDirs(distro: string, kind: string): WslPluginBaseDirs | undefined {
  const home = resolveWslHomeDirectory(distro);
  if (!home) return undefined;
  const linuxBase = `${home}/.lightcode/agent-plugins/${kind}`;
  return { home, linuxBase, uncBase: toWslUncPath(distro, linuxBase) };
}

export function getNativePluginBaseDir(kind: string, baseDir?: string): string {
  const paths = resolveLightcodePaths(baseDir);
  return join(paths.agentPluginsDir, kind);
}

/**
 * Print a one-line warning at module load when a provider's bundled plugin
 * manifest is missing (the `0.0.0` sentinel from `readBundledPluginVersion`).
 * The coordinator treats `0.0.0` as a no-cache retry-on-success state.
 *
 * Optionally pass `devHint` to surface the path layout that contributors
 * should check (dev source dir, packaged resources dir, prepare script).
 */
export function warnIfPluginManifestMissing(kind: string, version: string, devHint?: string): void {
  if (version !== "0.0.0") return;
  let message =
    `[${kind}] plugin manifest not found at module load — CLI hooks disabled for this session. ` +
    "If you just added the plugin files, restart the app to enable hooks.";
  if (devHint) message += ` ${devHint}`;
  console.warn(message);
}

// ── Native hook wrapper ──────────────────────────────────────────────────

/**
 * Filename of the per-plugin native hook wrapper. The wrapper sits next
 * to `forward.mjs` in the plugin staging dir and runs `forward.mjs` under
 * lightcode's bundled Electron Node via `ELECTRON_RUN_AS_NODE=1`. On
 * Windows we write a `.cmd` because cmd.exe doesn't accept inline
 * `VAR=val` prefixes; everywhere else we write a POSIX `.sh`.
 */
export function getNativeHookWrapperFilename(): string {
  return process.platform === "win32" ? "lightcode-hook.cmd" : "lightcode-hook.sh";
}

/**
 * Render the wrapper script body. `electronPath` is baked in absolute
 * (typically `process.execPath` of the running supervisor) so the wrapper
 * doesn't depend on PATH or env var inheritance. `forward.mjs` is
 * resolved relative to the wrapper at runtime — keeps the wrapper
 * portable if the staging dir is relocated.
 */
export function renderNativeHookWrapper(electronPath: string): string {
  if (process.platform === "win32") {
    const safePath = electronPath.replaceAll('"', '""');
    return [
      "@echo off",
      "setlocal",
      "set ELECTRON_RUN_AS_NODE=1",
      `"${safePath}" "%~dp0forward.mjs" %*`,
      "",
    ].join("\r\n");
  }
  const safePath = electronPath.replaceAll("'", "'\\''");
  return [
    "#!/bin/sh",
    'dir=$(dirname "$0")',
    `exec env ELECTRON_RUN_AS_NODE=1 '${safePath}' "$dir/forward.mjs" "$@"`,
    "",
  ].join("\n");
}

/**
 * Write the native hook wrapper into `pluginDir` next to `forward.mjs`.
 * Chmods to 0755 on POSIX. Returns the absolute path to the wrapper
 * (suitable for use as a hook command in agent settings).
 *
 * Pass an explicit `electronPath` to override `process.execPath` — useful
 * for tests and for the rare case where the supervisor is itself running
 * under bare Node (e.g. `pnpm tsx`) instead of inside the Electron
 * binary; production callers should use the default.
 */
export function writeNativeHookWrapper(pluginDir: string, electronPath?: string): string {
  const filename = getNativeHookWrapperFilename();
  const target = join(pluginDir, filename);
  const body = renderNativeHookWrapper(electronPath ?? process.execPath);
  mkdirSync(pluginDir, { recursive: true });
  let needsWrite = true;
  try {
    needsWrite = readFileSync(target, "utf8") !== body;
  } catch {
    // File missing or unreadable — fall through to writeFileSync below.
  }
  if (needsWrite) writeFileSync(target, body, "utf8");
  if (process.platform !== "win32") {
    try {
      chmodSync(target, 0o755);
    } catch {
      // Best-effort; subsequent exec will surface a clearer error.
    }
  }
  return target;
}

/**
 * Verify the native wrapper is staged when the install context is native.
 * WSL installs bake the absolute node path into the hook command directly
 * and don't use a wrapper.
 */
export function hasNativeHookWrapper(readableDir: string, target: "native" | "wsl"): boolean {
  if (target === "wsl") return true;
  return existsSync(join(readableDir, getNativeHookWrapperFilename()));
}

/**
 * WSL hook command head: `'<absolute-node-path>' '<forward.mjs-path>'`.
 * Used by Claude/Codex/Gemini to render hook commands that pass an
 * absolute node path so /bin/sh -c never falls back to PATH lookup.
 */
export function buildWslHookCommandHead(nodePath: string, forwardMjsPath: string): string {
  return `${quoteHookCommandArg(nodePath, "wsl")} ${quoteHookCommandArg(forwardMjsPath, "wsl")}`;
}

/**
 * For WSL adapter contexts, resolve the absolute Node path the install
 * should bake into hook commands. Returns `{ ok: true, nodePath }` on
 * success or `{ ok: false, reason }` on failure (no node found and
 * download failed). For native contexts, returns `{ ok: true }` with no
 * node path — the install uses Electron-as-Node via the wrapper instead.
 */
export async function resolveInstallNodePath(
  ctx: AgentEnvContext | undefined,
): Promise<{ ok: true; nodePath?: string } | { ok: false; reason: string }> {
  if (!ctx || ctx.envKind !== "wsl" || !ctx.wslDistro) return { ok: true };
  try {
    const { resolveNodeForDistro } = await import("../../wsl/runtime");
    const resolved = await resolveNodeForDistro(ctx.wslDistro);
    return { ok: true, nodePath: resolved.nodePath };
  } catch (error) {
    return {
      ok: false,
      reason: `failed to resolve node in WSL distro ${ctx.wslDistro}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
