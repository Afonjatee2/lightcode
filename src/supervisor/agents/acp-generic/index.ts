/**
 * Generic ACP driver — any user-registered binary that speaks standard ACP.
 *
 * Composes `AcpStructuredSession` (which talks ACP via stdio) with the shared
 * `acp/canonicalMapping.ts` mapper. **No new ACP code lives here** — this file
 * is purely configuration glue between an `AgentInstanceConfig` and the
 * existing ACP plumbing used by Copilot today.
 *
 * v1 entry point: `createAcpGenericAdapter(instance)` returns an `AgentAdapter`
 * the supervisor's registry can register exactly like a built-in adapter. The
 * settings UI for adding instances ships in a follow-up; the runtime can read
 * instances from `settings.json` today.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type {
  AgentInstanceConfig,
  AcpGenericInstanceConfig,
  AgentCapability,
  AgentStatus,
  AuthState,
  ProjectLocation,
} from "@/shared/contracts";
import { parseAcpGenericInstanceConfig } from "@/shared/contracts";
import {
  authenticateAcpAgent,
  createAcpStructuredSession,
  logoutAcpAgent,
  probeAcpCapabilities,
  type AcpProbeResult,
} from "../acp";
import {
  buildAgentCommand,
  type AgentAdapter,
  type AgentEnvContext,
  type CommandSpec,
  type CreateStructuredSessionInput,
} from "../base";

/** Prefix for generic-ACP `kind` values. Unique per registered instance. */
export const ACP_GENERIC_KIND_PREFIX = "acp-generic:";
type AcpAuthMethod = NonNullable<AcpProbeResult["authMethods"]>[number];
type AcpEnvVarAuthMethod = Extract<AcpAuthMethod, { type: "env_var" }>;
type AcpTerminalAuthMethod = Extract<AcpAuthMethod, { type: "terminal" }>;
type AcpAgentAuthMethod = Exclude<AcpAuthMethod, AcpEnvVarAuthMethod | AcpTerminalAuthMethod>;

export function isAcpGenericKind(kind: string): boolean {
  return kind.startsWith(ACP_GENERIC_KIND_PREFIX);
}

/** Extract the instance id portion of an `acp-generic:<id>` kind. */
export function extractAcpGenericInstanceId(kind: string): string | undefined {
  return kind.startsWith(ACP_GENERIC_KIND_PREFIX)
    ? kind.slice(ACP_GENERIC_KIND_PREFIX.length)
    : undefined;
}

const GENERIC_ACP_DEFAULT_CAPABILITIES: AgentCapability = {
  models: [],
  efforts: [],
  modelEfforts: {},
  modes: ["agent"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: false,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  presentationModes: ["gui"],
  settingDefs: [],
};

export function createAcpGenericAdapter(instance: AgentInstanceConfig): AgentAdapter {
  const cfg = parseAcpGenericInstanceConfig(instance.config);
  const kind = `${ACP_GENERIC_KIND_PREFIX}${instance.id}`;
  const label = instance.displayName ?? cfg.binary;

  const capabilities: AgentCapability = {
    ...GENERIC_ACP_DEFAULT_CAPABILITIES,
    ...(cfg.capabilities?.models?.length
      ? { models: cfg.capabilities.models.map((m) => ({ id: m, label: m })) }
      : {}),
    ...(cfg.capabilities?.modes?.length
      ? { modes: cfg.capabilities.modes as AgentCapability["modes"] }
      : {}),
  };

  const adapter: AgentAdapter = {
    kind,
    label,
    binary: cfg.binary,
    capabilities,
    async detectInstall(ctx?: AgentEnvContext): Promise<AgentStatus> {
      const installed = isProbablyInstalled(cfg.binary);
      const rawProbe = installed
        ? await probeGenericCapabilities(ctx, cfg, instance, label)
        : undefined;
      const probeResult = rawProbe
        ? {
            ...rawProbe,
            ...(rawProbe.authMethods
              ? { authMethods: dedupeAuthMethods(rawProbe.authMethods) }
              : {}),
          }
        : undefined;
      const authState: AuthState = resolveGenericAuthState(cfg, instance, probeResult, ctx);
      const loginCommand = resolveGenericLoginCommand(cfg, probeResult);
      const providerMetadata = resolveGenericProviderMetadata(probeResult);
      return {
        kind,
        label,
        installed,
        ...(instance.icon ? { icon: instance.icon } : {}),
        ...(instance.version ? { version: instance.version } : {}),
        authState,
        ...(loginCommand ? { loginCommand } : {}),
        ...(providerMetadata ? { providerMetadata } : {}),
        ...(probeResult?.authMethods ? { authMethods: probeResult.authMethods } : {}),
        ...(probeResult?.authLogoutSupported ? { authLogoutSupported: true } : {}),
        capabilities: mergeAcpProbeCapabilities(capabilities, probeResult),
      };
    },
    buildLaunchArgv() {
      // Generic ACP is chat-only — there is no PTY launch path. Return an
      // argv that would fail loudly if invoked by the terminal-mode runtime,
      // but normal flow uses createStructuredSession instead.
      return { binary: cfg.binary, args: cfg.args ?? [] };
    },
    buildResumeArgv() {
      return { binary: cfg.binary, args: cfg.args ?? [] };
    },
    createInitialSessionRef() {
      return undefined;
    },
    async createStructuredSession(input: CreateStructuredSessionInput) {
      const command = buildGenericCommand(input.projectLocation, cfg, instance);
      return createAcpStructuredSession(command, input);
    },
  };

  return adapter;
}

export async function authenticateAcpGenericInstance(
  instance: AgentInstanceConfig,
  methodId: string,
  ctx?: AgentEnvContext,
): Promise<void> {
  const cfg = parseAcpGenericInstanceConfig(instance.config);
  const location = detectProbeLocation(ctx);
  const command = buildGenericCommand(location, cfg, instance, authBrowserEnv(location));
  await authenticateAcpAgent(command.command, command.args, methodId, {
    ...(command.cwd ? { processCwd: command.cwd } : {}),
    ...(command.env ? { env: command.env } : {}),
    label: instance.displayName ?? cfg.binary,
  });
}

export async function logoutAcpGenericInstance(
  instance: AgentInstanceConfig,
  ctx?: AgentEnvContext,
): Promise<void> {
  const cfg = parseAcpGenericInstanceConfig(instance.config);
  const location = detectProbeLocation(ctx);
  const command = buildGenericCommand(location, cfg, instance);
  await logoutAcpAgent(command.command, command.args, {
    ...(command.cwd ? { processCwd: command.cwd } : {}),
    ...(command.env ? { env: command.env } : {}),
    label: instance.displayName ?? cfg.binary,
  });
}

function detectProbeLocation(ctx: AgentEnvContext | undefined): ProjectLocation {
  if (ctx?.envKind === "wsl" && ctx.wslDistro) {
    return {
      kind: "wsl",
      distro: ctx.wslDistro,
      linuxPath: "/",
      uncPath: "\\\\wsl$",
    };
  }
  if (process.platform === "win32") {
    return { kind: "windows", path: homedir() };
  }
  return { kind: "posix", path: homedir() };
}

async function probeGenericCapabilities(
  ctx: AgentEnvContext | undefined,
  cfg: AcpGenericInstanceConfig,
  instance: AgentInstanceConfig,
  label: string,
): Promise<AcpProbeResult | undefined> {
  const location = detectProbeLocation(ctx);
  const command = buildGenericCommand(location, cfg, instance);
  const sessionCwd = location.kind === "wsl" ? location.linuxPath : location.path;
  return probeAcpCapabilities(command.command, command.args, sessionCwd, {
    ...(command.cwd ? { processCwd: command.cwd } : {}),
    ...(command.env ? { env: command.env } : {}),
    label,
  });
}

function mergeAcpProbeCapabilities(
  capabilities: AgentCapability,
  probeResult: AcpProbeResult | undefined,
): AgentCapability {
  if (!probeResult) return capabilities;
  const merged: AgentCapability = {
    ...capabilities,
    ...(probeResult.models ? { models: probeResult.models } : {}),
    ...(probeResult.efforts ? { efforts: probeResult.efforts } : {}),
    ...(probeResult.defaultEffort ? { defaultEffort: probeResult.defaultEffort } : {}),
    ...(probeResult.modelEfforts ? { modelEfforts: probeResult.modelEfforts } : {}),
    ...(probeResult.modes ? { modes: probeResult.modes } : {}),
    ...(probeResult.approvalPolicies ? { approvalPolicies: probeResult.approvalPolicies } : {}),
    ...(probeResult.slashCommands ? { slashCommands: probeResult.slashCommands } : {}),
  };
  // Synthetic "never" policy for agents that don't advertise a bypass mode
  // (e.g. glm-acp-agent). The session layer auto-approves requestPermission
  // when this policy is selected, so users get the same effect even though
  // the agent never offered yolo/autopilot at the protocol level.
  if (merged.approvalPolicies.length === 0 && merged.modes.includes("agent")) {
    merged.approvalPolicies = [{ id: "never", label: "Bypass approvals" }];
  }
  return merged;
}

function buildGenericCommand(
  location: ProjectLocation,
  cfg: AcpGenericInstanceConfig,
  instance: AgentInstanceConfig,
  extraEnv?: Record<string, string>,
): CommandSpec {
  const args = cfg.args ?? [];
  const env: Record<string, string> = { ...(extraEnv ?? {}) };
  if (instance.environment) {
    for (const [name, value] of Object.entries(instance.environment)) {
      env[name] = value.value;
    }
  }
  // For "fixed" cwd, mirror the existing wrapper but pass the override.
  // Generic ACP almost always wants the project cwd; the fixedCwd escape
  // hatch is rare.
  if (cfg.cwd === "fixed" && cfg.fixedCwd) {
    return {
      command: cfg.binary,
      args,
      cwd: cfg.fixedCwd,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  return buildAgentCommand(location, cfg.binary, args, undefined, env);
}

function authBrowserEnv(location: ProjectLocation): Record<string, string> | undefined {
  if (location.kind !== "wsl") return undefined;
  return { BROWSER: 'cmd.exe /c start ""' };
}

function isProbablyInstalled(binary: string): boolean {
  // Absolute path → check existence. Otherwise we can't easily probe without
  // platform-specific code; report as installed (true) and let the user catch
  // the failure on launch. Detection probes run on a hot path; we keep this
  // cheap.
  if (binary.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(binary)) {
    return existsSync(binary);
  }
  return true;
}

function isEnvVarAuthMethod(method: AcpAuthMethod): method is AcpEnvVarAuthMethod {
  return ("type" in method && method.type === "env_var") || "vars" in method;
}

function isTerminalAuthMethod(method: AcpAuthMethod): method is AcpTerminalAuthMethod {
  return "type" in method && method.type === "terminal";
}

function isAgentAuthMethod(method: AcpAuthMethod): method is AcpAgentAuthMethod {
  return !isEnvVarAuthMethod(method) && !isTerminalAuthMethod(method);
}

// Some ACP agents (e.g. glm-acp-agent) advertise both an env_var method and a
// typeless "agent" method for the same credential — the agent-owned one is a
// stub whose authenticate() just acks. Drop those duplicates so the UI shows
// only the real flow.
function dedupeAuthMethods(methods: readonly AcpAuthMethod[]): AcpAuthMethod[] {
  const envVarNames = new Set(methods.filter(isEnvVarAuthMethod).map((method) => method.name));
  return methods.filter((method) => !(isAgentAuthMethod(method) && envVarNames.has(method.name)));
}

function resolveGenericAuthState(
  cfg: AcpGenericInstanceConfig,
  instance: AgentInstanceConfig,
  probeResult: AcpProbeResult | undefined,
  ctx: AgentEnvContext | undefined,
): AuthState {
  if (cfg.authMode === "envVar" && cfg.authEnvVar) {
    const value = instance.environment?.[cfg.authEnvVar]?.value ?? process.env[cfg.authEnvVar];
    return value && value.length > 0 ? "authenticated" : "missing";
  }
  for (const method of probeResult?.authMethods ?? []) {
    if (!isEnvVarAuthMethod(method)) continue;
    const requiredVars = method.vars.filter((variable) => variable.optional !== true);
    if (
      requiredVars.some(
        (variable) => !(instance.environment?.[variable.name]?.value ?? process.env[variable.name]),
      )
    ) {
      return "missing";
    }
    if (requiredVars.length > 0) {
      return "authenticated";
    }
  }
  // Interactive (browser/CLI) login state is per-env — a Windows browser
  // session does not carry over into a WSL distro, and vice versa. Trust
  // the persisted ack from our own `authenticate()` call rather than
  // inferring auth from `sessionEstablished` (some agents, e.g. Cline,
  // accept `newSession` without enforcing auth).
  if (isInteractiveAuthAcknowledged(instance, ctx)) {
    return "authenticated";
  }
  if (
    probeResult?.authMethods?.some(
      (method) => isTerminalAuthMethod(method) || isAgentAuthMethod(method),
    )
  ) {
    return "missing";
  }
  return "unknown";
}

function isInteractiveAuthAcknowledged(
  instance: AgentInstanceConfig,
  ctx: AgentEnvContext | undefined,
): boolean {
  const ack = instance.authAcknowledged;
  if (!ack) return false;
  if (ctx?.envKind === "wsl" && ctx.wslDistro) {
    return ack.wsl?.[ctx.wslDistro] === true;
  }
  return ack.native === true;
}

function resolveGenericLoginCommand(
  cfg: AcpGenericInstanceConfig,
  probeResult: AcpProbeResult | undefined,
): string | undefined {
  const terminalMethod = probeResult?.authMethods?.find(isTerminalAuthMethod);
  if (!terminalMethod) return undefined;
  return [cfg.binary, ...(cfg.args ?? []), ...(terminalMethod.args ?? [])].join(" ");
}

function resolveGenericProviderMetadata(
  probeResult: AcpProbeResult | undefined,
): AgentStatus["providerMetadata"] | undefined {
  const methods = probeResult?.authMethods?.filter(isEnvVarAuthMethod);
  if (!methods?.length) return undefined;
  return { authMethod: [...new Set(methods.map((method) => method.name))].join(", ") };
}
