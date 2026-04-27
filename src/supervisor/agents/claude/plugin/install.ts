import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toWslUncPath } from "@/shared/wsl";
import type { AgentEnvContext } from "../../base";
import { deployFilesToWslHome } from "../../../wsl/wslDeploy";
import {
  PLUGIN_ASSET_FILES,
  copyPluginAssetsIfStale,
  createPluginSourceResolver,
  getNativePluginBaseDir,
  getWslPluginBaseDirs,
  isWslPluginContext,
  quoteHookCommandArg,
  readBundledPluginVersion,
  readPluginManifest,
  type PluginManifest,
} from "../../plugin/installerBase";

/**
 * Claude Code plugin installer.
 *
 * "Install" here just means: stage the plugin assets at a stable location
 * outside the Electron asar/source tree so that:
 *   1. Claude Code can read `forward.mjs` as a regular file (asar reads fail
 *      from child Node processes), and
 *   2. We can render a Claude `--settings <path>` JSON file that points
 *      `command` at the staged forwarder.
 *
 * The flow is idempotent: every call copies `plugin.json` + `forward.mjs`
 * from source and regenerates `settings.json` + `hooks/hooks.json` (full hook
 * list for debug + intent forwarding). That keeps the staging dir in sync
 * with the current build even if a previous version left stale files behind.
 *
 * For WSL projects the plugin must live INSIDE the distro because Claude
 * runs there and can't read `\\wsl.localhost\` paths reliably from inside
 * a login shell. We reuse the shared `deployFilesToWslHome` primitive (the
 * same one the bridge uses for `bridge.mjs`) and emit a settings file with
 * Linux-side paths.
 */

export interface ClaudePluginPaths {
  /**
   * Directory containing forward.mjs, plugin.json, hooks/hooks.json. For
   * WSL contexts this is a Linux path inside the distro (e.g.
   * `/home/sdsle/.lightcode/agent-plugins/claude`); the caller must NOT
   * pass it to native fs APIs.
   */
  pluginDir: string;
  /** Path to the generated Claude settings file (passed via `--settings`). */
  settingsPath: string;
  /** Plugin semver from plugin.json. */
  version: string;
}

const callerDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url ?? "file://"));

const resolveSourceDir = createPluginSourceResolver({
  kind: "claude",
  sourceEnvVar: "LIGHTCODE_CLAUDE_PLUGIN_SOURCE",
  callerDir,
});

/**
 * Single source of truth for the plugin semver: `plugin.json` next to this
 * package in the repo / resources tree. Used by the Claude adapter for install
 * cache keys; `forward.mjs` reads the same file from disk next to itself at
 * runtime after staging.
 */
export function readBundledClaudePluginVersion(): string {
  return readBundledPluginVersion(resolveSourceDir);
}

/** Compute the plugin staging dir without performing any install work. */
export function getClaudePluginPaths(ctx?: AgentEnvContext): ClaudePluginPaths {
  if (isWslPluginContext(ctx)) {
    const wsl = getWslPluginBaseDirs(ctx.wslDistro, "claude");
    if (!wsl) return { pluginDir: "", settingsPath: "", version: "0.0.0" };
    let version = "0.0.0";
    try {
      version = readPluginManifest(wsl.uncBase).version;
    } catch {
      // staged manifest missing or distro unreachable.
    }
    return {
      pluginDir: wsl.linuxBase,
      settingsPath: `${wsl.linuxBase}/settings.json`,
      version,
    };
  }
  const pluginDir = getNativePluginBaseDir("claude", ctx?.baseDir);
  let version = "0.0.0";
  try {
    version = readPluginManifest(pluginDir).version;
  } catch {
    // staged manifest missing; caller should run installClaudePlugin first.
  }
  return {
    pluginDir,
    settingsPath: join(pluginDir, "settings.json"),
    version,
  };
}

/**
 * Stage the Claude plugin assets and write a `settings.json` that wires
 * Claude's hook system to invoke the staged `forward.mjs`. Idempotent —
 * safe to call from every supervisor boot. For WSL contexts, assets are
 * staged into the distro's `~/.lightcode/agent-plugins/claude/` via the
 * shared `deployFilesToWslHome` helper.
 */
export function installClaudePlugin(
  ctx?: AgentEnvContext,
): { ok: true; paths: ClaudePluginPaths; version: string } | { ok: false; reason: string } {
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
    return installClaudePluginWsl(ctx.wslDistro, sourceDir, manifest);
  }

  const pluginDir = getNativePluginBaseDir("claude", ctx?.baseDir);
  mkdirSync(pluginDir, { recursive: true });
  copyPluginAssetsIfStale(sourceDir, pluginDir);

  const settingsPath = join(pluginDir, "settings.json");
  const settings = renderClaudeSettings(pluginDir, "native");
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  const hooksPath = join(pluginDir, "hooks", "hooks.json");
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, JSON.stringify(settings, null, 2), "utf8");

  console.log(
    `[supervisor] Claude hook plugin staged v${manifest.version} at ${pluginDir} (forward.mjs, settings.json, hooks/hooks.json)`,
  );

  return {
    ok: true,
    version: manifest.version,
    paths: { pluginDir, settingsPath, version: manifest.version },
  };
}

function installClaudePluginWsl(
  distro: string,
  sourceDir: string,
  manifest: PluginManifest,
): { ok: true; paths: ClaudePluginPaths; version: string } | { ok: false; reason: string } {
  const deploy = deployFilesToWslHome(
    distro,
    PLUGIN_ASSET_FILES.map((file) => ({
      src: join(sourceDir, file),
      relDest: `agent-plugins/claude/${file}`,
    })),
  );
  if (!deploy) {
    return { ok: false, reason: `failed to stage Claude plugin into wsl distro ${distro}` };
  }

  const linuxPluginDir = `${deploy.linuxBaseDir}/agent-plugins/claude`;
  const linuxSettingsPath = `${linuxPluginDir}/settings.json`;

  // The settings.json itself lives inside the distro alongside the plugin so
  // Claude reads it from a Linux-side path. We write it via the same UNC
  // path the deploy helper uses.
  const uncSettingsPath = toWslUncPath(distro, linuxSettingsPath);
  try {
    mkdirSync(dirname(uncSettingsPath), { recursive: true });
    const settings = renderClaudeSettings(linuxPluginDir, "wsl");
    writeFileSync(uncSettingsPath, JSON.stringify(settings, null, 2), "utf8");
    const uncHooksPath = toWslUncPath(distro, `${linuxPluginDir}/hooks/hooks.json`);
    mkdirSync(dirname(uncHooksPath), { recursive: true });
    writeFileSync(uncHooksPath, JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `failed to write Claude settings.json in wsl distro ${distro}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  console.log(
    `[supervisor] Claude hook plugin staged v${manifest.version} in WSL distro ${distro} at ${linuxPluginDir} (forward.mjs, settings.json, hooks/hooks.json)`,
  );

  return {
    ok: true,
    version: manifest.version,
    paths: {
      pluginDir: linuxPluginDir,
      settingsPath: linuxSettingsPath,
      version: manifest.version,
    },
  };
}

/**
 * Read whether the plugin is already installed at the canonical staging path
 * for the given environment.
 */
export function isClaudePluginInstalled(ctx?: AgentEnvContext): {
  installed: boolean;
  version?: string;
} {
  if (isWslPluginContext(ctx)) {
    const wsl = getWslPluginBaseDirs(ctx.wslDistro, "claude");
    if (!wsl) return { installed: false };
    return verifyClaudeInstallAt(wsl.uncBase);
  }
  return verifyClaudeInstallAt(getNativePluginBaseDir("claude", ctx?.baseDir));
}

function verifyClaudeInstallAt(readableDir: string): { installed: boolean; version?: string } {
  if (!existsSync(join(readableDir, "plugin.json"))) return { installed: false };
  if (!existsSync(join(readableDir, "forward.mjs"))) return { installed: false };
  if (!existsSync(join(readableDir, "hooks", "hooks.json"))) return { installed: false };
  if (!existsSync(join(readableDir, "settings.json"))) return { installed: false };
  try {
    const version = readPluginManifest(readableDir).version;
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

interface ClaudeHookEntry {
  /** When set, Claude only runs this group for matching tool / notification / etc. */
  matcher?: string;
  hooks: Array<{ type: "command"; command: string }>;
}

interface ClaudeSettings {
  hooks: Record<string, ClaudeHookEntry[]>;
  /**
   * Opt into iTerm2-style OSC 9 notifications for "needs input" moments.
   * Claude Code only emits OSC 9 when this setting is active; we force it on
   * for sessions lightcode launches so L2 can read `needs_reply` / idle edges
   * from structured OSC instead of fragile TUI text parsing. See
   * `claudeOscHint` in ../index.ts.
   */
  preferredNotifChannel: "iterm2";
}

/**
 * Default hooks: intents we forward plus observability for permission / tool
 * failure paths. Claude has no "permission answered" hook, so we infer:
 *   - approve → `PostToolUse` (tool ran) → back to `working`
 *   - deny (where Claude recovers) → `PostToolUseFailure` → back to `working`
 *   - Esc / hard interrupt → no hook (Claude Code gap); `Stop` itself
 *     explicitly does not fire on user interrupts.
 * `matcher: "*"` is required for tool-style events.
 */
const CLAUDE_HOOK_SPECS_MINIMAL: ReadonlyArray<{ event: string; matcher?: string }> = [
  { event: "SessionStart" },
  { event: "UserPromptSubmit" },
  { event: "PermissionRequest" },
  { event: "PermissionDenied", matcher: "*" },
  { event: "PostToolUse", matcher: "*" },
  { event: "PostToolUseFailure", matcher: "*" },
  { event: "ElicitationResult", matcher: "*" },
  { event: "Notification" },
  { event: "Stop" },
  { event: "StopFailure" },
];

/**
 * When `LIGHTCODE_HOOK_DEBUG` is set during plugin install, register every
 * documented Claude hook so `forward.mjs` can log unmapped events too. Tool
 * events use `matcher: "*"` (high churn — enable debug only temporarily).
 */
const CLAUDE_HOOK_SPECS_FULL: ReadonlyArray<{ event: string; matcher?: string }> = [
  ...CLAUDE_HOOK_SPECS_MINIMAL,
  { event: "SessionEnd" },
  { event: "PreToolUse", matcher: "*" },
  { event: "SubagentStart", matcher: "*" },
  { event: "SubagentStop", matcher: "*" },
  { event: "TaskCreated" },
  { event: "TaskCompleted" },
  { event: "TeammateIdle" },
  { event: "InstructionsLoaded", matcher: "*" },
  { event: "ConfigChange", matcher: "*" },
  { event: "CwdChanged" },
  { event: "FileChanged", matcher: "*" },
  { event: "WorktreeCreate" },
  { event: "WorktreeRemove" },
  { event: "PreCompact", matcher: "*" },
  { event: "PostCompact", matcher: "*" },
  { event: "Elicitation", matcher: "*" },
];

function claudeHookSpecsForInstall(): ReadonlyArray<{ event: string; matcher?: string }> {
  const v = process.env.LIGHTCODE_HOOK_DEBUG;
  const debug = v === "1" || v === "true" || Boolean(v && v !== "0" && v !== "false");
  return debug ? CLAUDE_HOOK_SPECS_FULL : CLAUDE_HOOK_SPECS_MINIMAL;
}

/**
 * Build the Claude `--settings` document. We embed the staged `forward.mjs`
 * path directly so that Claude can spawn it without needing
 * `LIGHTCODE_PLUGIN_DIR` to be present in its env. The same object is written
 * to `hooks/hooks.json` after install so diagnostics match what Claude loads.
 */
function renderClaudeSettings(pluginDir: string, target: "native" | "wsl"): ClaudeSettings {
  const forwardPath =
    target === "wsl" ? `${pluginDir}/forward.mjs` : join(pluginDir, "forward.mjs");
  const hooks: Record<string, ClaudeHookEntry[]> = {};
  for (const spec of claudeHookSpecsForInstall()) {
    const entry: ClaudeHookEntry = {
      hooks: [
        {
          type: "command",
          command: `node ${quoteHookCommandArg(forwardPath, target)} ${spec.event}`,
        },
      ],
    };
    if (spec.matcher !== undefined) {
      entry.matcher = spec.matcher;
    }
    hooks[spec.event] = [entry];
  }
  return { hooks, preferredNotifChannel: "iterm2" };
}
