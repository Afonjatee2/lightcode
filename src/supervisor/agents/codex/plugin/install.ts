import { execFileSync } from "node:child_process";
import {
  constants as fsConstants,
  copyFileSync as fsCopyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLightcodePaths } from "@/shared/lightcodePaths";
import type { AgentEnvContext } from "../../base";
import { batchWslCommands, quotePosixShellArg, resolveWslHomeDirectory } from "../../base";
import { toWslUncPath } from "@/shared/wsl";
import { deployFilesToWslHome } from "../../../wsl/wslDeploy";

export interface CodexPluginPaths {
  pluginDir: string;
  /** Private CODEX_HOME used only for Codex processes spawned by Lightcode. */
  codexHomeDir: string;
  /** Path to hooks.json inside the private CODEX_HOME. */
  codexHooksPath: string;
  version: string;
}

interface PluginManifest {
  version: string;
  [key: string]: unknown;
}

const ASSET_FILES = ["plugin.json", "forward.mjs"] as const;

const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
] as const;

/** Match any Lightcode-staged forward.mjs command line in hooks.json. */
const LIGHTCODE_FORWARD_RE = /agent-plugins(?:[/\\]+)codex(?:[/\\]+)forward\.mjs/;

function resolveSourceDir(): string {
  const candidates: string[] = [];
  const override = process.env.LIGHTCODE_CODEX_PLUGIN_SOURCE;
  if (override) candidates.push(resolve(override));
  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
    candidates.push(join(process.resourcesPath, "agent-plugins", "codex"));
  }
  const here =
    typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url ?? "file://"));
  candidates.push(resolve(here, "../../../agent-plugins/codex"));
  candidates.push(resolve(here, "../../src/supervisor/agents/codex/plugin"));
  candidates.push(resolve(here, "../../../src/supervisor/agents/codex/plugin"));
  candidates.push(resolve(here, "../../resources/agent-plugins/codex"));
  candidates.push(resolve(here, "../resources/agent-plugins/codex"));
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "plugin.json"))) return candidate;
  }
  throw new Error(`codex plugin source dir not found; checked: ${candidates.join(", ")}`);
}

function readManifest(dir: string): PluginManifest {
  const raw = readFileSync(join(dir, "plugin.json"), "utf8");
  return JSON.parse(raw) as PluginManifest;
}

export function readBundledCodexPluginVersion(): string {
  try {
    const v = readManifest(resolveSourceDir()).version;
    return typeof v === "string" && v.length > 0 ? v : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function copyFileSync(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const data = readFileSync(source);
  writeFileSync(target, data);
}

function isFresh(sourceDir: string, targetDir: string): boolean {
  for (const file of ASSET_FILES) {
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

function isWslContext(ctx: AgentEnvContext | undefined): ctx is AgentEnvContext & {
  envKind: "wsl";
  wslDistro: string;
} {
  return Boolean(ctx && ctx.envKind === "wsl" && ctx.wslDistro);
}

export function getCodexPluginPaths(ctx?: AgentEnvContext, baseDir?: string): CodexPluginPaths {
  if (isWslContext(ctx)) {
    const home = resolveWslHomeDirectory(ctx.wslDistro);
    const linuxPlugin = home ? `${home}/.lightcode/agent-plugins/codex` : "";
    const linuxCodexHome = linuxPlugin ? `${linuxPlugin}/home` : "";
    const linuxHooks = linuxCodexHome ? `${linuxCodexHome}/hooks.json` : "";
    let version = "0.0.0";
    if (home) {
      try {
        version = readManifest(toWslUncPath(ctx.wslDistro, linuxPlugin)).version;
      } catch {
        // ignore
      }
    }
    return {
      pluginDir: linuxPlugin,
      codexHomeDir: linuxCodexHome,
      codexHooksPath: linuxHooks,
      version,
    };
  }
  const paths = resolveLightcodePaths(baseDir);
  const pluginDir = join(paths.agentPluginsDir, "codex");
  const codexHomeDir = join(pluginDir, "home");
  const codexHooksPath = join(codexHomeDir, "hooks.json");
  let version = "0.0.0";
  try {
    version = readManifest(pluginDir).version;
  } catch {
    // ignore
  }
  return { pluginDir, codexHomeDir, codexHooksPath, version };
}

function pruneLightcodeGroups(groups: unknown): unknown[] {
  if (!Array.isArray(groups)) return [];
  return groups.filter((g) => {
    if (!g || typeof g !== "object") return true;
    const rec = g as { hooks?: unknown };
    const hooks = rec.hooks;
    if (!Array.isArray(hooks)) return true;
    return !hooks.some((h) => {
      if (!h || typeof h !== "object") return false;
      const cmd = (h as { type?: string; command?: string }).command;
      return typeof cmd === "string" && LIGHTCODE_FORWARD_RE.test(cmd);
    });
  });
}

function commandForEvent(forwardPath: string, event: string): string {
  return `node ${JSON.stringify(forwardPath)} ${event}`;
}

function buildLightcodeGroup(event: string, forwardPath: string): Record<string, unknown> {
  const command = commandForEvent(forwardPath, event);
  const hook = { type: "command", command };
  if (event === "SessionStart" || event === "PreToolUse" || event === "PostToolUse") {
    return { matcher: "*", hooks: [hook] };
  }
  return { hooks: [hook] };
}

/**
 * Merge Lightcode Codex hook matcher groups into a parsed `hooks.json` document.
 * Exported for unit tests.
 */
export function mergeCodexHooksDocument(
  existingParsed: unknown,
  forwardPath: string,
): { hooks: Record<string, unknown[]> } {
  let hooksRoot: Record<string, unknown> = {};
  if (
    existingParsed &&
    typeof existingParsed === "object" &&
    "hooks" in existingParsed &&
    (existingParsed as { hooks: unknown }).hooks &&
    typeof (existingParsed as { hooks: unknown }).hooks === "object"
  ) {
    hooksRoot = { ...(existingParsed as { hooks: Record<string, unknown> }).hooks };
  }

  for (const event of CODEX_HOOK_EVENTS) {
    const prev = hooksRoot[event];
    const pruned = pruneLightcodeGroups(prev);
    pruned.push(buildLightcodeGroup(event, forwardPath));
    hooksRoot[event] = pruned;
  }

  return { hooks: hooksRoot as Record<string, unknown[]> };
}

function writeHooksJson(path: string, doc: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

function parseExistingHooks(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const CODEX_LINK_TARGETS = [
  { name: "sessions", kind: "dir" as const },
  { name: "session_index.jsonl", kind: "file" as const },
  { name: "auth.json", kind: "file" as const },
  { name: "config.toml", kind: "file" as const },
];

function seedNativeCodexHome(codexHomeDir: string): void {
  mkdirSync(codexHomeDir, { recursive: true });
  const globalCodexHome = join(homedir(), ".codex");
  mkdirSync(join(globalCodexHome, "sessions"), { recursive: true });
  if (!existsSync(join(globalCodexHome, "session_index.jsonl"))) {
    writeFileSync(join(globalCodexHome, "session_index.jsonl"), "", { flag: "a" });
  }
  restorePrivateStateFile(codexHomeDir, globalCodexHome, "auth.json");
  restorePrivateStateFile(codexHomeDir, globalCodexHome, "config.toml");

  for (const { name, kind } of CODEX_LINK_TARGETS) {
    ensureNativeStateLink(join(globalCodexHome, name), join(codexHomeDir, name), kind);
  }
}

function restorePrivateStateFile(
  codexHomeDir: string,
  globalCodexHome: string,
  file: "auth.json" | "config.toml",
): void {
  const source = join(codexHomeDir, file);
  const target = join(globalCodexHome, file);
  if (existsSync(target) || !existsSync(source)) return;
  try {
    fsCopyFileSync(source, target);
  } catch {
    // Best-effort recovery for Windows when file symlinks were unavailable.
  }
}

function pathExistsOrSymlink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function ensureNativeStateLink(source: string, target: string, kind: "dir" | "file"): void {
  if (pathExistsOrSymlink(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  try {
    symlinkSync(source, target, kind === "dir" && process.platform === "win32" ? "junction" : kind);
    return;
  } catch {
    // Fall through to hard-link/copy compatibility for platforms where file
    // symlinks are disabled.
  }
  if (kind === "file" && existsSync(source)) {
    try {
      linkSync(source, target);
      return;
    } catch {
      try {
        // COPYFILE_EXCL: fail-closed if the target appeared between checks
        // (e.g., concurrent install) so we never clobber an existing link.
        fsCopyFileSync(source, target, fsConstants.COPYFILE_EXCL);
      } catch {
        // Best-effort compatibility seed; Codex can still recreate state.
      }
    }
  }
}

function seedWslCodexHome(distro: string, home: string, linuxCodexHome: string): void {
  const uncCodexHome = toWslUncPath(distro, linuxCodexHome);
  mkdirSync(uncCodexHome, { recursive: true });
  const globalCodexHome = `${home}/.codex`;
  const linkExists = (path: string) =>
    `[ -e ${quotePosixShellArg(path)} ] || [ -L ${quotePosixShellArg(path)} ]`;
  // ln -s can fail on Windows-mounted filesystems (9p / DrvFs). For files,
  // fall back to hardlink, then copy. Dirs only get the symlink attempt.
  const linkLine = (name: string, kind: "dir" | "file") => {
    const target = quotePosixShellArg(`${linuxCodexHome}/${name}`);
    const source = quotePosixShellArg(`${globalCodexHome}/${name}`);
    const attempts = [
      linkExists(`${linuxCodexHome}/${name}`),
      `ln -s ${source} ${target}`,
      ...(kind === "file" ? [`ln ${source} ${target}`, `cp ${source} ${target}`] : []),
    ];
    return attempts.join(" || ");
  };
  const script = [
    [
      "mkdir -p",
      quotePosixShellArg(linuxCodexHome),
      quotePosixShellArg(`${globalCodexHome}/sessions`),
    ].join(" "),
    `touch ${quotePosixShellArg(`${globalCodexHome}/session_index.jsonl`)}`,
    ...CODEX_LINK_TARGETS.map(({ name, kind }) => linkLine(name, kind)),
  ].join("\n");
  batchWslCommands(distro, [script]);
}

const MIN_CODEX_SEMVER = [0, 122, 0] as const;

export function parseCodexVersionLine(line: string): [number, number, number] | null {
  const m = /codex-cli\s+(\d+)\.(\d+)\.(\d+)/i.exec(line.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function semverGte(a: [number, number, number], b: readonly [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

/**
 * Probe `codex --version` on PATH. Returns null if unavailable or unparsable.
 *
 * On Windows the `codex` binary from npm global install is a `.cmd` shim,
 * which Node's `execFile` cannot invoke directly (`ENOENT` without `shell`,
 * `EINVAL` with the full `.cmd` path). We enable `shell: true` on win32 so
 * cmd.exe resolves PATHEXT for us. Args are hardcoded `--version` with no
 * user input, so the shell invocation carries no injection risk.
 */
export function probeCodexCliSemver(): [number, number, number] | null {
  try {
    const out = execFileSync("codex", ["--version"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    return parseCodexVersionLine(out);
  } catch {
    return null;
  }
}

export function isCodexSemverSupportedForHooks(v: [number, number, number] | null): boolean {
  if (!v) return false;
  return semverGte(v, MIN_CODEX_SEMVER);
}

export function isCodexVersionSupportedForHooks(): boolean {
  return isCodexSemverSupportedForHooks(probeCodexCliSemver());
}

export function installCodexPlugin(
  ctx?: AgentEnvContext,
  baseDir?: string,
): { ok: true; paths: CodexPluginPaths; version: string } | { ok: false; reason: string } {
  let sourceDir: string;
  try {
    sourceDir = resolveSourceDir();
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  let manifest: PluginManifest;
  try {
    manifest = readManifest(sourceDir);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  if (isWslContext(ctx)) {
    return installCodexPluginWsl(ctx.wslDistro, sourceDir, manifest);
  }

  const paths = resolveLightcodePaths(baseDir);
  const pluginDir = join(paths.agentPluginsDir, "codex");
  const codexHomeDir = join(pluginDir, "home");
  mkdirSync(pluginDir, { recursive: true });
  seedNativeCodexHome(codexHomeDir);

  if (!isFresh(sourceDir, pluginDir)) {
    for (const file of ASSET_FILES) {
      copyFileSync(join(sourceDir, file), join(pluginDir, file));
    }
  }

  const forwardPath = join(pluginDir, "forward.mjs");
  const hooksPath = join(codexHomeDir, "hooks.json");
  const existing = parseExistingHooks(hooksPath);
  if (existing === null && existsSync(hooksPath)) {
    return { ok: false, reason: "malformed private Codex hooks.json (invalid JSON)" };
  }

  try {
    const merged = mergeCodexHooksDocument(existing, forwardPath);
    writeHooksJson(hooksPath, merged);
  } catch (error) {
    return {
      ok: false,
      reason: `failed to write private Codex hooks.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  console.log(
    `[supervisor] Codex hook plugin staged v${manifest.version} at ${pluginDir}; wrote private CODEX_HOME ${codexHomeDir}`,
  );

  return {
    ok: true,
    version: manifest.version,
    paths: {
      pluginDir,
      codexHomeDir,
      codexHooksPath: hooksPath,
      version: manifest.version,
    },
  };
}

function installCodexPluginWsl(
  distro: string,
  sourceDir: string,
  manifest: PluginManifest,
): { ok: true; paths: CodexPluginPaths; version: string } | { ok: false; reason: string } {
  const deploy = deployFilesToWslHome(
    distro,
    ASSET_FILES.map((file) => ({
      src: join(sourceDir, file),
      relDest: `agent-plugins/codex/${file}`,
    })),
  );
  if (!deploy) {
    return { ok: false, reason: `failed to stage Codex plugin into wsl distro ${distro}` };
  }

  const home = deploy.home;
  const linuxForward = `${deploy.linuxBaseDir}/agent-plugins/codex/forward.mjs`;
  const linuxCodexHome = `${deploy.linuxBaseDir}/agent-plugins/codex/home`;
  seedWslCodexHome(distro, home, linuxCodexHome);
  const linuxHooksPath = `${linuxCodexHome}/hooks.json`;
  const uncHooks = toWslUncPath(distro, linuxHooksPath);

  const existing = parseExistingHooks(uncHooks);
  if (existing === null && existsSync(uncHooks)) {
    return {
      ok: false,
      reason: `malformed private Codex hooks.json in wsl distro ${distro}`,
    };
  }

  try {
    const merged = mergeCodexHooksDocument(existing, linuxForward);
    mkdirSync(dirname(uncHooks), { recursive: true });
    writeFileSync(uncHooks, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `failed to write hooks.json in wsl distro ${distro}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  console.log(
    `[supervisor] Codex hook plugin staged v${manifest.version} in WSL distro ${distro} at ${deploy.linuxBaseDir}/agent-plugins/codex; wrote private CODEX_HOME ${linuxCodexHome}`,
  );

  return {
    ok: true,
    version: manifest.version,
    paths: {
      pluginDir: `${deploy.linuxBaseDir}/agent-plugins/codex`,
      codexHomeDir: linuxCodexHome,
      codexHooksPath: linuxHooksPath,
      version: manifest.version,
    },
  };
}

export function isCodexPluginInstalled(
  ctx?: AgentEnvContext,
  baseDir?: string,
): Promise<{ installed: boolean; version?: string }> {
  if (isWslContext(ctx)) {
    return Promise.resolve(isCodexPluginInstalledWslSync(ctx.wslDistro));
  }
  const paths = resolveLightcodePaths(baseDir);
  const pluginDir = join(paths.agentPluginsDir, "codex");
  const codexHomeDir = join(pluginDir, "home");
  const hooksPath = join(codexHomeDir, "hooks.json");
  if (!existsSync(join(pluginDir, "plugin.json"))) return Promise.resolve({ installed: false });
  if (!existsSync(join(pluginDir, "forward.mjs"))) return Promise.resolve({ installed: false });
  if (!existsSync(hooksPath)) return Promise.resolve({ installed: false });
  try {
    const raw = readFileSync(hooksPath, "utf8");
    const doc = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    if (!doc.hooks) return Promise.resolve({ installed: false });
    let found = false;
    for (const event of CODEX_HOOK_EVENTS) {
      const groups = doc.hooks[event];
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!g || typeof g !== "object") continue;
        const hooks = (g as { hooks?: unknown }).hooks;
        if (!Array.isArray(hooks)) continue;
        for (const h of hooks) {
          if (!h || typeof h !== "object") continue;
          const cmd = (h as { command?: string }).command;
          if (typeof cmd === "string" && LIGHTCODE_FORWARD_RE.test(cmd)) {
            found = true;
            break;
          }
        }
      }
    }
    if (!found) return Promise.resolve({ installed: false });
    const version = readManifest(pluginDir).version;
    return Promise.resolve({ installed: true, version });
  } catch {
    return Promise.resolve({ installed: false });
  }
}

function isCodexPluginInstalledWslSync(distro: string): { installed: boolean; version?: string } {
  const home = resolveWslHomeDirectory(distro);
  if (!home) return { installed: false };
  const linuxPlugin = `${home}/.lightcode/agent-plugins/codex`;
  const linuxCodexHome = `${linuxPlugin}/home`;
  const linuxHooks = `${linuxCodexHome}/hooks.json`;
  const uncPlugin = toWslUncPath(distro, linuxPlugin);
  const uncHooks = toWslUncPath(distro, linuxHooks);
  if (!existsSync(join(uncPlugin, "plugin.json"))) return { installed: false };
  if (!existsSync(join(uncPlugin, "forward.mjs"))) return { installed: false };
  if (!existsSync(uncHooks)) return { installed: false };
  try {
    const raw = readFileSync(uncHooks, "utf8");
    const doc = JSON.parse(raw) as { hooks?: Record<string, unknown> };
    if (!doc.hooks) return { installed: false };
    let found = false;
    for (const event of CODEX_HOOK_EVENTS) {
      const groups = doc.hooks[event];
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!g || typeof g !== "object") continue;
        const hooks = (g as { hooks?: unknown }).hooks;
        if (!Array.isArray(hooks)) continue;
        for (const h of hooks) {
          if (!h || typeof h !== "object") continue;
          const cmd = (h as { command?: string }).command;
          if (typeof cmd === "string" && LIGHTCODE_FORWARD_RE.test(cmd)) {
            found = true;
            break;
          }
        }
      }
    }
    if (!found) return { installed: false };
    const version = readManifest(uncPlugin).version;
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}
