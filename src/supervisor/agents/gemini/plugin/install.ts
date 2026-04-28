import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toWslUncPath } from "@/shared/wsl";
import type { AgentEnvContext } from "../../base";
import { deployFilesToWslHome } from "../../../wsl/wslDeploy";
import {
  PLUGIN_ASSET_FILES,
  buildWslHookCommandHead,
  copyPluginAssetsIfStale,
  createPluginSourceResolver,
  getNativeHookWrapperFilename,
  getNativePluginBaseDir,
  getWslPluginBaseDirs,
  hasNativeHookWrapper,
  isWslPluginContext,
  quoteHookCommandArg,
  readBundledPluginVersion,
  readPluginManifest,
  writeNativeHookWrapper,
  type PluginManifest,
} from "../../plugin/installerBase";

export interface GeminiPluginPaths {
  pluginDir: string;
  settingsPath: string;
  version: string;
}

interface GeminiHookEntry {
  matcher?: string;
  hooks: Array<{
    name: string;
    type: "command";
    command: string;
    timeout: number;
  }>;
}

interface GeminiSettings {
  hooksConfig: {
    notifications: false;
  };
  hooks: Record<string, GeminiHookEntry[]>;
}

const GEMINI_HOOK_SPECS: ReadonlyArray<{ event: string; matcher?: string }> = [
  { event: "SessionStart" },
  { event: "BeforeAgent" },
  { event: "BeforeModel" },
  { event: "BeforeTool", matcher: "*" },
  { event: "AfterTool", matcher: "*" },
  { event: "AfterAgent" },
  { event: "Notification" },
];

const callerDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url ?? "file://"));

const resolveSourceDir = createPluginSourceResolver({
  kind: "gemini",
  sourceEnvVar: "LIGHTCODE_GEMINI_PLUGIN_SOURCE",
  callerDir,
});

export function readBundledGeminiPluginVersion(): string {
  return readBundledPluginVersion(resolveSourceDir);
}

export function getGeminiPluginPaths(ctx?: AgentEnvContext): GeminiPluginPaths {
  if (isWslPluginContext(ctx)) {
    const wsl = getWslPluginBaseDirs(ctx.wslDistro, "gemini");
    if (!wsl) return { pluginDir: "", settingsPath: "", version: "0.0.0" };
    let version = "0.0.0";
    try {
      version = readPluginManifest(wsl.uncBase).version;
    } catch {
      // staged manifest missing or distro unreachable
    }
    return {
      pluginDir: wsl.linuxBase,
      settingsPath: `${wsl.linuxBase}/settings.json`,
      version,
    };
  }
  const pluginDir = getNativePluginBaseDir("gemini", ctx?.baseDir);
  let version = "0.0.0";
  try {
    version = readPluginManifest(pluginDir).version;
  } catch {
    // staged manifest missing; caller should install first
  }
  return {
    pluginDir,
    settingsPath: join(pluginDir, "settings.json"),
    version,
  };
}

export interface InstallGeminiPluginOptions {
  /**
   * Required for WSL contexts: absolute Linux path to the Node binary the
   * staged hook command should use. Comes from `resolveNodeForDistro`.
   * Ignored for native contexts (we use Electron-as-Node via the wrapper).
   */
  resolvedNodePath?: string | undefined;
}

export function installGeminiPlugin(
  ctx?: AgentEnvContext,
  options?: InstallGeminiPluginOptions,
): { ok: true; paths: GeminiPluginPaths; version: string } | { ok: false; reason: string } {
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
    if (!options?.resolvedNodePath) {
      return {
        ok: false,
        reason:
          "WSL Gemini plugin install requires a resolved node path; the adapter must call resolveNodeForDistro before installing.",
      };
    }
    return installGeminiPluginWsl(ctx.wslDistro, sourceDir, manifest, options.resolvedNodePath);
  }

  const pluginDir = getNativePluginBaseDir("gemini", ctx?.baseDir);
  mkdirSync(pluginDir, { recursive: true });
  copyPluginAssetsIfStale(sourceDir, pluginDir);
  const wrapperPath = writeNativeHookWrapper(pluginDir);

  const settingsPath = join(pluginDir, "settings.json");
  const settings = renderGeminiSettings(quoteHookCommandArg(wrapperPath, "native"));
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  console.log(
    `[supervisor] Gemini hook plugin staged v${manifest.version} at ${pluginDir} (forward.mjs, ${getNativeHookWrapperFilename()}, settings.json)`,
  );

  return {
    ok: true,
    version: manifest.version,
    paths: { pluginDir, settingsPath, version: manifest.version },
  };
}

function installGeminiPluginWsl(
  distro: string,
  sourceDir: string,
  manifest: PluginManifest,
  resolvedNodePath: string,
): { ok: true; paths: GeminiPluginPaths; version: string } | { ok: false; reason: string } {
  const deploy = deployFilesToWslHome(
    distro,
    PLUGIN_ASSET_FILES.map((file) => ({
      src: join(sourceDir, file),
      relDest: `agent-plugins/gemini/${file}`,
    })),
  );
  if (!deploy) {
    return { ok: false, reason: `failed to stage Gemini plugin into wsl distro ${distro}` };
  }

  const linuxPluginDir = `${deploy.linuxBaseDir}/agent-plugins/gemini`;
  const linuxSettingsPath = `${linuxPluginDir}/settings.json`;
  const linuxForwardPath = `${linuxPluginDir}/forward.mjs`;
  const uncSettingsPath = toWslUncPath(distro, linuxSettingsPath);
  const headExpression = buildWslHookCommandHead(resolvedNodePath, linuxForwardPath);

  try {
    mkdirSync(dirname(uncSettingsPath), { recursive: true });
    const settings = renderGeminiSettings(headExpression);
    writeFileSync(uncSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `failed to write Gemini settings.json in wsl distro ${distro}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  console.log(
    `[supervisor] Gemini hook plugin staged v${manifest.version} in WSL distro ${distro} at ${linuxPluginDir} (forward.mjs, settings.json)`,
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

export function isGeminiPluginInstalled(ctx?: AgentEnvContext): {
  installed: boolean;
  version?: string;
} {
  if (isWslPluginContext(ctx)) {
    const wsl = getWslPluginBaseDirs(ctx.wslDistro, "gemini");
    if (!wsl) return { installed: false };
    return verifyGeminiInstallAt(wsl.uncBase, "wsl");
  }
  return verifyGeminiInstallAt(getNativePluginBaseDir("gemini", ctx?.baseDir), "native");
}

function verifyGeminiInstallAt(
  readableDir: string,
  target: "native" | "wsl",
): { installed: boolean; version?: string } {
  if (!existsSync(join(readableDir, "plugin.json"))) return { installed: false };
  if (!existsSync(join(readableDir, "forward.mjs"))) return { installed: false };
  if (!existsSync(join(readableDir, "settings.json"))) return { installed: false };
  if (!hasNativeHookWrapper(readableDir, target)) return { installed: false };
  try {
    const settings = JSON.parse(readFileSync(join(readableDir, "settings.json"), "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    if (!hasGeminiHooks(settings.hooks)) return { installed: false };
    const version = readPluginManifest(readableDir).version;
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * Match either the WSL command shape (`forward.mjs` invoked via absolute
 * node path) or the native shape (`lightcode-hook.{sh,cmd}` wrapper).
 */
const LIGHTCODE_GEMINI_HOOK_RE =
  /agent-plugins(?:[/\\]+)gemini(?:[/\\]+)(?:forward\.mjs|lightcode-hook\.(?:sh|cmd))/;

function hasGeminiHooks(hooks: Record<string, unknown> | undefined): boolean {
  if (!hooks) return false;
  for (const spec of GEMINI_HOOK_SPECS) {
    const groups = hooks[spec.event];
    if (!Array.isArray(groups) || groups.length === 0) return false;
    const found = groups.some((group) => {
      if (!group || typeof group !== "object") return false;
      const hookEntries = (group as { hooks?: unknown }).hooks;
      if (!Array.isArray(hookEntries)) return false;
      return hookEntries.some((hook) => {
        if (!hook || typeof hook !== "object") return false;
        const command = (hook as { command?: unknown }).command;
        return typeof command === "string" && LIGHTCODE_GEMINI_HOOK_RE.test(command);
      });
    });
    if (!found) return false;
  }
  return true;
}

export function renderGeminiSettings(headExpression: string): GeminiSettings {
  const hooks: Record<string, GeminiHookEntry[]> = {};
  for (const spec of GEMINI_HOOK_SPECS) {
    const entry: GeminiHookEntry = {
      hooks: [
        {
          name: `lightcode-status-${spec.event}`,
          type: "command",
          command: `${headExpression} ${spec.event}`,
          timeout: 5000,
        },
      ],
    };
    if (spec.matcher !== undefined) entry.matcher = spec.matcher;
    hooks[spec.event] = [entry];
  }
  return { hooksConfig: { notifications: false }, hooks };
}
