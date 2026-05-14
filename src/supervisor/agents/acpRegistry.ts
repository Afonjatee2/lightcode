import { execFile } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  acpRegistryListResultSchema,
  type AcpRegistryAgent,
  type AcpRegistryListResult,
  type AuthenticateAcpRegistryAgentPayload,
  type AgentInstanceConfig,
  type AgentKind,
  type InstalledAcpRegistryAgent,
  type LogoutAcpRegistryAgentPayload,
} from "@/shared/contracts";
import {
  defaultSharedSettings,
  normalizeSharedSettings,
  type SharedSettings,
} from "@/shared/settings";
import { downloadToFile } from "../runtime/download";
import { decryptSecret, encryptSecret, transformSensitiveAgentSecrets } from "../secretStorage";
import { authenticateAcpGenericInstance, logoutAcpGenericInstance } from "./acp-generic";
import type { AgentEnvContext } from "./base";

const execFileAsync = promisify(execFile);

const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const ACP_REGISTRY_INSTALL_DIR = "acp-registry";

const REGISTRY_AGENT_FAMILY_KIND: Record<string, AgentKind> = {
  "claude-acp": "claude",
  "codex-acp": "codex",
  cursor: "cursor",
  gemini: "gemini",
  "github-copilot": "copilot",
  "github-copilot-cli": "copilot",
  opencode: "opencode",
};

export function resolveRegistryAgentFamilyKind(agentId: string): AgentKind | undefined {
  return REGISTRY_AGENT_FAMILY_KIND[agentId];
}

export async function fetchAcpRegistry(): Promise<AcpRegistryListResult> {
  const response = await fetch(ACP_REGISTRY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: HTTP ${response.status}`);
  }
  return acpRegistryListResultSchema.parse(await response.json());
}

export function backfillAcpRegistryAgentIcons(input: {
  registry: AcpRegistryListResult;
  settingsPath: string;
}): boolean {
  const settings = readAcpRegistrySettings(input.settingsPath);
  const agentsById = new Map(input.registry.agents.map((agent) => [agent.id, agent]));
  let changed = false;

  const installedAgents = { ...settings.acpRegistryInstalledAgents };
  for (const [id, record] of Object.entries(installedAgents)) {
    const agent = agentsById.get(id);
    if (!agent) continue;
    const icon = agent.icon;
    if ((!icon || record.icon === icon) && record.version === agent.version) continue;
    installedAgents[id] = { ...record, version: agent.version, ...(icon ? { icon } : {}) };
    changed = true;
  }

  const instances = { ...settings.agentInstances };
  for (const [id, instance] of Object.entries(instances)) {
    if (instance.driver !== "acp-generic") continue;
    const agent = agentsById.get(id);
    if (!agent) continue;
    const icon = agent.icon;
    if ((!icon || instance.icon === icon) && instance.version === agent.version) continue;
    instances[id] = { ...instance, version: agent.version, ...(icon ? { icon } : {}) };
    changed = true;
  }

  if (!changed) return false;
  writeAcpRegistrySettings(input.settingsPath, {
    ...settings,
    acpRegistryInstalledAgents: installedAgents,
    agentInstances: instances,
  });
  return true;
}

export function readAcpRegistrySettings(settingsPath: string): SharedSettings {
  try {
    return transformSensitiveAgentSecrets(
      normalizeSharedSettings(JSON.parse(readFileSync(settingsPath, "utf8"))),
      dirname(settingsPath),
      decryptSecret,
    );
  } catch {
    return { ...defaultSharedSettings };
  }
}

function writeAcpRegistrySettings(settingsPath: string, settings: SharedSettings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const encrypted = transformSensitiveAgentSecrets(settings, dirname(settingsPath), encryptSecret);
  writeFileSync(settingsPath, JSON.stringify(encrypted, null, 2), "utf8");
}

function registryInstallRecord(
  agent: AcpRegistryAgent,
  adapterKind: AgentKind,
  installKind: InstalledAcpRegistryAgent["installKind"],
): InstalledAcpRegistryAgent {
  return {
    id: agent.id,
    name: agent.name,
    version: agent.version,
    ...(agent.icon ? { icon: agent.icon } : {}),
    installedAt: new Date().toISOString(),
    adapterKind,
    installKind,
  };
}

function packageInstance(agent: AcpRegistryAgent, command: "npx" | "uvx"): AgentInstanceConfig {
  const dist = agent.distribution[command];
  if (!dist) {
    throw new Error(`${agent.name} does not have a ${command} distribution`);
  }
  const env = dist.env
    ? Object.fromEntries(
        Object.entries(dist.env).map(([key, value]) => [key, { value, sensitive: false }]),
      )
    : undefined;
  return {
    id: agent.id,
    driver: "acp-generic",
    displayName: agent.name,
    version: agent.version,
    ...(agent.icon ? { icon: agent.icon } : {}),
    enabled: true,
    ...(env ? { environment: env } : {}),
    config: {
      binary: command,
      args:
        command === "npx"
          ? ["-y", dist.package, ...(dist.args ?? [])]
          : [dist.package, ...(dist.args ?? [])],
      cwd: "project",
      authMode: "none",
    },
  };
}

function currentBinaryTarget(): string {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `${os}-${arch}`;
}

function archiveFileName(url: string): string {
  try {
    return basename(new URL(url).pathname) || "download";
  } catch {
    return "download";
  }
}

async function extractArchive(archivePath: string, installDir: string): Promise<void> {
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-Command",
          "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
          archivePath,
          installDir,
        ],
        { windowsHide: true },
      );
    } else {
      await execFileAsync("unzip", ["-q", "-o", archivePath, "-d", installDir], {
        windowsHide: true,
      });
    }
    return;
  }

  if (
    archivePath.endsWith(".tar.gz") ||
    archivePath.endsWith(".tgz") ||
    archivePath.endsWith(".tar.bz2") ||
    archivePath.endsWith(".tbz2")
  ) {
    await execFileAsync("tar", ["-xf", archivePath, "-C", installDir], { windowsHide: true });
    return;
  }
}

function resolveInstalledCommandPath(installDir: string, cmd: string): string {
  return join(installDir, ...cmd.replace(/^\.\//, "").split("/"));
}

async function binaryInstance(
  agent: AcpRegistryAgent,
  baseDir: string,
): Promise<AgentInstanceConfig> {
  const targetName = currentBinaryTarget();
  const target = agent.distribution.binary?.[targetName];
  if (!target) {
    throw new Error(`${agent.name} does not publish a binary for ${targetName}`);
  }

  const rootDir = join(baseDir, ACP_REGISTRY_INSTALL_DIR, agent.id, agent.version);
  const installDir = join(rootDir, "bin");
  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(installDir, { recursive: true });

  const archiveName = archiveFileName(target.archive);
  const archivePath = join(rootDir, archiveName);
  await downloadToFile(target.archive, archivePath);
  await extractArchive(archivePath, installDir);

  const commandPath = resolveInstalledCommandPath(installDir, target.cmd);
  if (!existsSync(commandPath)) {
    copyFileSync(archivePath, commandPath);
  }
  if (process.platform !== "win32") {
    chmodSync(commandPath, 0o755);
  }

  const env = target.env
    ? Object.fromEntries(
        Object.entries(target.env).map(([key, value]) => [key, { value, sensitive: false }]),
      )
    : undefined;
  return {
    id: agent.id,
    driver: "acp-generic",
    displayName: agent.name,
    version: agent.version,
    ...(agent.icon ? { icon: agent.icon } : {}),
    enabled: true,
    ...(env ? { environment: env } : {}),
    config: {
      binary: commandPath,
      args: target.args ?? [],
      cwd: "project",
      authMode: "none",
    },
  };
}

async function genericInstance(
  agent: AcpRegistryAgent,
  baseDir: string,
): Promise<AgentInstanceConfig> {
  if (agent.distribution.npx) return packageInstance(agent, "npx");
  if (agent.distribution.uvx) return packageInstance(agent, "uvx");
  if (agent.distribution.binary) return binaryInstance(agent, baseDir);
  throw new Error(`${agent.name} does not include a supported distribution`);
}

export async function installAcpRegistryAgent(input: {
  agentId: string;
  baseDir: string;
  settingsPath: string;
}): Promise<InstalledAcpRegistryAgent[]> {
  const registry = await fetchAcpRegistry();
  const agent = registry.agents.find((entry) => entry.id === input.agentId);
  if (!agent) {
    throw new Error(`ACP registry agent not found: ${input.agentId}`);
  }

  const settings = readAcpRegistrySettings(input.settingsPath);
  const instance = await genericInstance(agent, input.baseDir);
  settings.agentInstances = { ...settings.agentInstances, [agent.id]: instance };
  settings.acpRegistryInstalledAgents = {
    ...settings.acpRegistryInstalledAgents,
    [agent.id]: registryInstallRecord(agent, `acp-generic:${agent.id}`, "generic"),
  };
  writeAcpRegistrySettings(input.settingsPath, settings);
  return Object.values(settings.acpRegistryInstalledAgents);
}

export function removeAcpRegistryAgent(input: {
  agentId: string;
  settingsPath: string;
}): InstalledAcpRegistryAgent[] {
  const settings = readAcpRegistrySettings(input.settingsPath);
  const nextInstalled = { ...settings.acpRegistryInstalledAgents };
  delete nextInstalled[input.agentId];
  const nextInstances = { ...settings.agentInstances };
  delete nextInstances[input.agentId];
  settings.acpRegistryInstalledAgents = nextInstalled;
  settings.agentInstances = nextInstances;
  writeAcpRegistrySettings(input.settingsPath, settings);
  return Object.values(settings.acpRegistryInstalledAgents);
}

export function setAcpRegistryAgentAuth(input: {
  agentId: string;
  environment: Record<string, string>;
  settingsPath: string;
}): InstalledAcpRegistryAgent[] {
  const settings = readAcpRegistrySettings(input.settingsPath);
  const instance = settings.agentInstances[input.agentId];
  if (!instance || instance.driver !== "acp-generic") {
    throw new Error(`ACP registry agent is not installed: ${input.agentId}`);
  }

  const environment = { ...(instance.environment ?? {}) };
  for (const [name, value] of Object.entries(input.environment)) {
    environment[name] = { value, sensitive: true };
  }

  settings.agentInstances = {
    ...settings.agentInstances,
    [input.agentId]: {
      ...instance,
      environment,
    },
  };
  writeAcpRegistrySettings(input.settingsPath, settings);
  return Object.values(settings.acpRegistryInstalledAgents);
}

export async function authenticateAcpRegistryAgent(input: {
  agentId: string;
  methodId: string;
  envKind?: AuthenticateAcpRegistryAgentPayload["envKind"];
  wslDistro?: string;
  settingsPath: string;
}): Promise<void> {
  const settings = readAcpRegistrySettings(input.settingsPath);
  const instance = settings.agentInstances[input.agentId];
  if (!instance || instance.driver !== "acp-generic") {
    throw new Error(`ACP registry agent is not installed: ${input.agentId}`);
  }
  const envContext: AgentEnvContext | undefined = input.envKind
    ? {
        envKind: input.envKind,
        ...(input.wslDistro ? { wslDistro: input.wslDistro } : {}),
      }
    : undefined;
  await authenticateAcpGenericInstance(instance, input.methodId, envContext);
  persistAuthAcknowledged(input.settingsPath, input.agentId, envContext, true);
}

export async function logoutAcpRegistryAgent(input: {
  agentId: string;
  envKind?: LogoutAcpRegistryAgentPayload["envKind"];
  wslDistro?: string;
  settingsPath: string;
}): Promise<void> {
  const settings = readAcpRegistrySettings(input.settingsPath);
  const instance = settings.agentInstances[input.agentId];
  if (!instance || instance.driver !== "acp-generic") {
    throw new Error(`ACP registry agent is not installed: ${input.agentId}`);
  }
  const envContext: AgentEnvContext | undefined = input.envKind
    ? {
        envKind: input.envKind,
        ...(input.wslDistro ? { wslDistro: input.wslDistro } : {}),
      }
    : undefined;
  // Best-effort ACP-side logout — some agents (e.g. Cline) do not implement
  // the ACP logout capability. The local ack is the source of truth for our
  // UI, so swallow "not supported" but propagate other failures.
  try {
    await logoutAcpGenericInstance(instance, envContext);
  } catch (error) {
    if (!isUnsupportedAcpLogoutError(error)) throw error;
  }
  persistAuthAcknowledged(input.settingsPath, input.agentId, envContext, false);
}

function isUnsupportedAcpLogoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /logout is not supported/i.test(message);
}

/**
 * Record/clear an interactive-login acknowledgement for one (agent, env) pair.
 * Env-var auth shares credentials across envs and is not tracked here; this
 * path only models browser/CLI login flows that are bound to a single env.
 */
function persistAuthAcknowledged(
  settingsPath: string,
  agentId: string,
  envContext: AgentEnvContext | undefined,
  acknowledged: boolean,
): void {
  const settings = readAcpRegistrySettings(settingsPath);
  const instance = settings.agentInstances[agentId];
  if (!instance) return;
  const current = instance.authAcknowledged ?? {};
  const nextWsl: Record<string, boolean> = { ...(current.wsl ?? {}) };
  let nextNative = current.native === true;
  if (envContext?.envKind === "wsl" && envContext.wslDistro) {
    if (acknowledged) {
      nextWsl[envContext.wslDistro] = true;
    } else {
      delete nextWsl[envContext.wslDistro];
    }
  } else {
    nextNative = acknowledged;
  }
  const hasWsl = Object.keys(nextWsl).length > 0;
  const next: { native?: boolean; wsl?: Record<string, boolean> } = {};
  if (nextNative) next.native = true;
  if (hasWsl) next.wsl = nextWsl;
  const hasAny = nextNative || hasWsl;
  settings.agentInstances = {
    ...settings.agentInstances,
    [agentId]: {
      ...instance,
      ...(hasAny ? { authAcknowledged: next } : {}),
    },
  };
  if (!hasAny) {
    delete settings.agentInstances[agentId]!.authAcknowledged;
  }
  writeAcpRegistrySettings(settingsPath, settings);
}
