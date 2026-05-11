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
  type AgentInstanceConfig,
  type AgentKind,
  type InstalledAcpRegistryAgent,
} from "@/shared/contracts";
import {
  defaultSharedSettings,
  normalizeSharedSettings,
  type SharedSettings,
} from "@/shared/settings";
import { downloadToFile } from "../runtime/download";

const execFileAsync = promisify(execFile);

const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const ACP_REGISTRY_INSTALL_DIR = "acp-registry";

const FIRST_CLASS_REGISTRY_AGENT_KIND: Record<string, AgentKind> = {
  "claude-acp": "claude",
  "codex-acp": "codex",
  cursor: "cursor",
  gemini: "gemini",
  "github-copilot": "copilot",
  "github-copilot-cli": "copilot",
  opencode: "opencode",
};

export function resolveFirstClassRegistryAgentKind(agentId: string): AgentKind | undefined {
  return FIRST_CLASS_REGISTRY_AGENT_KIND[agentId];
}

export async function fetchAcpRegistry(): Promise<AcpRegistryListResult> {
  const response = await fetch(ACP_REGISTRY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: HTTP ${response.status}`);
  }
  return acpRegistryListResultSchema.parse(await response.json());
}

export function readAcpRegistrySettings(settingsPath: string): SharedSettings {
  try {
    return normalizeSharedSettings(JSON.parse(readFileSync(settingsPath, "utf8")));
  } catch {
    return { ...defaultSharedSettings };
  }
}

function writeAcpRegistrySettings(settingsPath: string, settings: SharedSettings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
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
  const firstClassKind = resolveFirstClassRegistryAgentKind(agent.id);
  if (firstClassKind) {
    delete settings.agentInstances[agent.id];
    settings.acpRegistryInstalledAgents = {
      ...settings.acpRegistryInstalledAgents,
      [agent.id]: registryInstallRecord(agent, firstClassKind, "first-class"),
    };
  } else {
    const instance = await genericInstance(agent, input.baseDir);
    settings.agentInstances = { ...settings.agentInstances, [agent.id]: instance };
    settings.acpRegistryInstalledAgents = {
      ...settings.acpRegistryInstalledAgents,
      [agent.id]: registryInstallRecord(agent, `acp-generic:${agent.id}`, "generic"),
    };
  }
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
