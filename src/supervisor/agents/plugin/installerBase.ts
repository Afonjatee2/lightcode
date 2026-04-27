import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
