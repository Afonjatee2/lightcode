import { copyFileSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toWslUncPath } from "@/shared/wsl";
import type { AgentEnvContext } from "../../base";
import { resolveWslHomeDirectory } from "../../base";
import {
  copyPluginAssetsIfStale,
  createPluginSourceResolver,
  getNativePluginBaseDir,
  getWslPluginBaseDirs,
  isWslPluginContext,
  readBundledPluginVersion,
  readPluginManifest,
  stagePluginAssetsToWsl,
  verifyStagedPluginAt,
  type PluginManifest,
} from "../../plugin/installerBase";

/**
 * OpenCode plugin installer.
 *
 * Unlike Claude/Codex/Gemini — which stage `forward.mjs` and render a
 * settings document so the agent CLI invokes the forwarder via shell command —
 * OpenCode loads plugin files in-process from `~/.config/opencode/plugins/`.
 * So "install" here means:
 *   1. Stage `plugin.mjs` + `plugin.json` to a canonical lightcode-managed
 *      location (`~/.lightcode/agent-plugins/opencode/`) — used for version
 *      bookkeeping, the manifest the supervisor reads at boot, and as the
 *      authoritative source for the file that gets dropped into OpenCode.
 *   2. Copy `plugin.mjs` to OpenCode's auto-scanned plugins directory as
 *      `lightcode-status.js` — OpenCode globs `{plugin,plugins}/*.{ts,js}`
 *      and ignores other extensions. OpenCode picks it up on next launch.
 *
 * The plugin file itself reads `LIGHTCODE_HOOK_URL` / `LIGHTCODE_HOOK_SECRET`
 * / `LIGHTCODE_THREAD_ID` etc. from `process.env` at hook time. When those
 * vars are unset (i.e. the user runs `opencode` outside Lightcode) the
 * handlers no-op.
 */

/** The two assets we publish — manifest for version reads + the plugin code. */
const OPENCODE_PLUGIN_ASSET_FILES = ["plugin.json", "plugin.mjs"] as const;

/**
 * Filename OpenCode auto-discovers in its plugins/ directory. Must use a `.js`
 * (or `.ts`) extension — OpenCode's loader scans `{plugin,plugins}/*.{ts,js}`
 * and silently ignores any other extension, so a `.mjs` drop is invisible to
 * it. The file's content is still ESM (top-level `import`) and runs fine under
 * Bun, which is OpenCode's runtime.
 */
const OPENCODE_PLUGIN_FILE_NAME = "lightcode-status.js";

/**
 * Older Lightcode versions dropped a `.mjs` here, which OpenCode never loaded
 * (see comment above). Cleaned up at install/uninstall time so a user
 * upgrading doesn't end up with two stale siblings.
 */
const OPENCODE_PLUGIN_LEGACY_FILE_NAME = "lightcode-status.mjs";

/**
 * Filename of the manifest dropped alongside the plugin file. The plugin code
 * reads `<basename>.plugin.json` from `import.meta.url`'s directory at load
 * time so `pluginVersion` in every emitted envelope reflects the staged
 * version.
 */
const OPENCODE_PLUGIN_MANIFEST_DROPPED_NAME = "lightcode-status.plugin.json";

export interface OpenCodePluginPaths {
  pluginDir: string;
  opencodePluginFile: string;
  version: string;
}

const callerDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url ?? "file://"));

const resolveSourceDir = createPluginSourceResolver({
  kind: "opencode",
  sourceEnvVar: "LIGHTCODE_OPENCODE_PLUGIN_SOURCE",
  callerDir,
});

export function readBundledOpenCodePluginVersion(): string {
  return readBundledPluginVersion(resolveSourceDir);
}

/**
 * Resolve the directory OpenCode auto-scans for plugins on the current
 * environment. Honors `OPENCODE_CONFIG_DIR` for native installs (per
 * https://opencode.ai/docs/config); WSL always uses `$HOME/.config/opencode`
 * inside the distro because the host can't introspect the distro's env.
 */
function resolveOpenCodeNativePluginsDir(): string {
  const override = process.env.OPENCODE_CONFIG_DIR;
  if (override && override.trim().length > 0) {
    return resolve(override, "plugins");
  }
  return join(homedir(), ".config", "opencode", "plugins");
}

function resolveOpenCodeWslPluginsDir(
  distro: string,
): { linuxDir: string; uncDir: string } | undefined {
  const home = resolveWslHomeDirectory(distro);
  if (!home) return undefined;
  const linuxDir = `${home}/.config/opencode/plugins`;
  return { linuxDir, uncDir: toWslUncPath(distro, linuxDir) };
}

export function getOpenCodePluginPaths(ctx?: AgentEnvContext): OpenCodePluginPaths {
  if (isWslPluginContext(ctx)) {
    const wsl = getWslPluginBaseDirs(ctx.wslDistro, "opencode");
    if (!wsl) {
      return { pluginDir: "", opencodePluginFile: "", version: "0.0.0" };
    }
    let version = "0.0.0";
    try {
      version = readPluginManifest(wsl.uncBase).version;
    } catch {
      // staged manifest absent on first install
    }
    const opencodeDir = resolveOpenCodeWslPluginsDir(ctx.wslDistro);
    return {
      pluginDir: wsl.linuxBase,
      opencodePluginFile: opencodeDir ? `${opencodeDir.linuxDir}/${OPENCODE_PLUGIN_FILE_NAME}` : "",
      version,
    };
  }
  const pluginDir = getNativePluginBaseDir("opencode", ctx?.baseDir);
  let version = "0.0.0";
  try {
    version = readPluginManifest(pluginDir).version;
  } catch {
    // staged manifest absent on first install
  }
  return {
    pluginDir,
    opencodePluginFile: join(resolveOpenCodeNativePluginsDir(), OPENCODE_PLUGIN_FILE_NAME),
    version,
  };
}

export function installOpenCodePlugin(
  ctx?: AgentEnvContext,
): { ok: true; paths: OpenCodePluginPaths; version: string } | { ok: false; reason: string } {
  let sourceDir: string;
  try {
    sourceDir = resolveSourceDir();
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  let manifest: PluginManifest;
  try {
    manifest = readPluginManifest(sourceDir);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  if (isWslPluginContext(ctx)) {
    return installOpenCodePluginWsl(ctx.wslDistro, sourceDir, manifest);
  }

  const pluginDir = getNativePluginBaseDir("opencode", ctx?.baseDir);
  mkdirSync(pluginDir, { recursive: true });
  copyPluginAssetsIfStale(sourceDir, pluginDir, OPENCODE_PLUGIN_ASSET_FILES);

  const opencodePluginsDir = resolveOpenCodeNativePluginsDir();
  const opencodePluginFile = join(opencodePluginsDir, OPENCODE_PLUGIN_FILE_NAME);
  const opencodeManifestFile = join(opencodePluginsDir, OPENCODE_PLUGIN_MANIFEST_DROPPED_NAME);
  try {
    mkdirSync(opencodePluginsDir, { recursive: true });
    copyFileSync(join(pluginDir, "plugin.mjs"), opencodePluginFile);
    copyFileSync(join(pluginDir, "plugin.json"), opencodeManifestFile);
    removeIfPresent(join(opencodePluginsDir, OPENCODE_PLUGIN_LEGACY_FILE_NAME));
  } catch (error) {
    return {
      ok: false,
      reason: `failed to copy lightcode-status plugin into ${opencodePluginsDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  console.log(
    `[supervisor] OpenCode hook plugin staged v${manifest.version} at ${pluginDir} ` +
      `→ ${opencodePluginFile}`,
  );

  return {
    ok: true,
    version: manifest.version,
    paths: { pluginDir, opencodePluginFile, version: manifest.version },
  };
}

function installOpenCodePluginWsl(
  distro: string,
  sourceDir: string,
  manifest: PluginManifest,
): { ok: true; paths: OpenCodePluginPaths; version: string } | { ok: false; reason: string } {
  const staged = stagePluginAssetsToWsl(distro, sourceDir, "opencode", OPENCODE_PLUGIN_ASSET_FILES);
  if (!staged.ok) return staged;

  const linuxPluginDir = staged.linuxPluginDir;
  const opencodeDir = resolveOpenCodeWslPluginsDir(distro);
  if (!opencodeDir) {
    return {
      ok: false,
      reason: `failed to resolve OpenCode plugins dir in wsl distro ${distro} (could not read $HOME)`,
    };
  }
  const opencodePluginFile = `${opencodeDir.linuxDir}/${OPENCODE_PLUGIN_FILE_NAME}`;
  const opencodePluginUnc = `${opencodeDir.uncDir}\\${OPENCODE_PLUGIN_FILE_NAME}`;
  const opencodeManifestUnc = `${opencodeDir.uncDir}\\${OPENCODE_PLUGIN_MANIFEST_DROPPED_NAME}`;
  const opencodeLegacyUnc = `${opencodeDir.uncDir}\\${OPENCODE_PLUGIN_LEGACY_FILE_NAME}`;
  const stagedPluginUnc = toWslUncPath(distro, `${linuxPluginDir}/plugin.mjs`);
  const stagedManifestUnc = toWslUncPath(distro, `${linuxPluginDir}/plugin.json`);

  try {
    mkdirSync(opencodeDir.uncDir, { recursive: true });
    copyFileSync(stagedPluginUnc, opencodePluginUnc);
    copyFileSync(stagedManifestUnc, opencodeManifestUnc);
    removeIfPresent(opencodeLegacyUnc);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `failed to copy lightcode-status plugin into ${opencodeDir.linuxDir} (distro ${distro}): ${detail}`,
    };
  }

  console.log(
    `[supervisor] OpenCode hook plugin staged v${manifest.version} in WSL distro ${distro} at ${linuxPluginDir} → ${opencodePluginFile}`,
  );

  return {
    ok: true,
    version: manifest.version,
    paths: {
      pluginDir: linuxPluginDir,
      opencodePluginFile,
      version: manifest.version,
    },
  };
}

export function isOpenCodePluginInstalled(ctx?: AgentEnvContext): {
  installed: boolean;
  version?: string;
} {
  if (isWslPluginContext(ctx)) {
    const wsl = getWslPluginBaseDirs(ctx.wslDistro, "opencode");
    if (!wsl) return { installed: false };
    const opencodeDir = resolveOpenCodeWslPluginsDir(ctx.wslDistro);
    if (!opencodeDir) return { installed: false };
    return verifyOpenCodeInstallAt(wsl.uncBase, opencodeDir.uncDir, "wsl");
  }
  return verifyOpenCodeInstallAt(
    getNativePluginBaseDir("opencode", ctx?.baseDir),
    resolveOpenCodeNativePluginsDir(),
    "native",
  );
}

function verifyOpenCodeInstallAt(
  readableStagingDir: string,
  readableOpencodeDir: string,
  target: "native" | "wsl",
): { installed: boolean; version?: string } {
  // Native uses `path.join` (platform-native separator). WSL paths are UNC
  // strings (`\\wsl.localhost\<distro>\...`) so we always concat with `\`.
  const joinDropped = (name: string) =>
    target === "wsl" ? `${readableOpencodeDir}\\${name}` : join(readableOpencodeDir, name);
  const droppedPlugin = joinDropped(OPENCODE_PLUGIN_FILE_NAME);
  const droppedManifest = joinDropped(OPENCODE_PLUGIN_MANIFEST_DROPPED_NAME);
  // Byte-for-byte equality on both files: a hand-edited drop is treated as
  // not-installed so the next install call restages.
  const filesByteMatch = (): boolean => {
    try {
      const stagedPlugin = readFileSync(join(readableStagingDir, "plugin.mjs"));
      const droppedPluginBuf = readFileSync(droppedPlugin);
      if (stagedPlugin.length !== droppedPluginBuf.length) return false;
      if (!stagedPlugin.equals(droppedPluginBuf)) return false;
      const stagedManifest = readFileSync(join(readableStagingDir, "plugin.json"));
      const droppedManifestBuf = readFileSync(droppedManifest);
      if (stagedManifest.length !== droppedManifestBuf.length) return false;
      return stagedManifest.equals(droppedManifestBuf);
    } catch {
      return false;
    }
  };
  return verifyStagedPluginAt(readableStagingDir, target, {
    assets: OPENCODE_PLUGIN_ASSET_FILES,
    requireNativeWrapper: false,
    extraCheck: filesByteMatch,
  });
}

// Removes the dropped `lightcode-status.js` + `lightcode-status.plugin.json`
// (and any legacy `lightcode-status.mjs`) from OpenCode's plugins/ directory;
// staging dir stays so version diagnostics survive. Best-effort: missing
// files / unreachable distros are swallowed.
export function uninstallOpenCodePlugin(ctx?: AgentEnvContext): void {
  const targets: string[] = [];
  if (isWslPluginContext(ctx)) {
    const opencodeDir = resolveOpenCodeWslPluginsDir(ctx.wslDistro);
    if (opencodeDir) {
      targets.push(`${opencodeDir.uncDir}\\${OPENCODE_PLUGIN_FILE_NAME}`);
      targets.push(`${opencodeDir.uncDir}\\${OPENCODE_PLUGIN_MANIFEST_DROPPED_NAME}`);
      targets.push(`${opencodeDir.uncDir}\\${OPENCODE_PLUGIN_LEGACY_FILE_NAME}`);
    }
  } else {
    const dir = resolveOpenCodeNativePluginsDir();
    targets.push(join(dir, OPENCODE_PLUGIN_FILE_NAME));
    targets.push(join(dir, OPENCODE_PLUGIN_MANIFEST_DROPPED_NAME));
    targets.push(join(dir, OPENCODE_PLUGIN_LEGACY_FILE_NAME));
  }
  for (const target of targets) {
    removeIfPresent(target);
  }
}

function removeIfPresent(path: string): void {
  try {
    const stat = statSync(path);
    if (stat.isFile()) unlinkSync(path);
  } catch {
    // file missing or unreachable
  }
}
