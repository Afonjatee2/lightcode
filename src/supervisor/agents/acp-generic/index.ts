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
import type {
  AgentInstanceConfig,
  AcpGenericInstanceConfig,
  AgentCapability,
  AgentStatus,
  AuthState,
  ProjectLocation,
} from "@/shared/contracts";
import { parseAcpGenericInstanceConfig } from "@/shared/contracts";
import { createAcpStructuredSession } from "../acp";
import {
  buildAgentCommand,
  type AgentAdapter,
  type AgentEnvContext,
  type CommandSpec,
  type CreateStructuredSessionInput,
} from "../base";

/** Prefix for generic-ACP `kind` values. Unique per registered instance. */
export const ACP_GENERIC_KIND_PREFIX = "acp-generic:";

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
    async detectInstall(_ctx?: AgentEnvContext): Promise<AgentStatus> {
      const installed = isProbablyInstalled(cfg.binary);
      const authState: AuthState = resolveGenericAuthState(cfg);
      return {
        kind,
        label,
        installed,
        ...(instance.icon ? { icon: instance.icon } : {}),
        authState,
        capabilities,
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

function buildGenericCommand(
  location: ProjectLocation,
  cfg: AcpGenericInstanceConfig,
  instance: AgentInstanceConfig,
): CommandSpec {
  const args = cfg.args ?? [];
  const env: Record<string, string> = {};
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

function resolveGenericAuthState(cfg: AcpGenericInstanceConfig): AuthState {
  if (cfg.authMode === "envVar" && cfg.authEnvVar) {
    const value = process.env[cfg.authEnvVar];
    return value && value.length > 0 ? "authenticated" : "missing";
  }
  return "unknown";
}
