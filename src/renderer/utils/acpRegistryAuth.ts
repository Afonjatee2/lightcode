import type {
  AgentEnvVarAuthMethod,
  AgentOwnedAuthMethod,
  AgentStatus,
  RefreshAgentScopeEnv,
} from "@/shared/contracts";

const ACP_GENERIC_PREFIX = "acp-generic:";

type StatusAuthMethod = NonNullable<AgentStatus["authMethods"]>[number];

export function acpGenericInstanceId(kind: string): string | undefined {
  return kind.startsWith(ACP_GENERIC_PREFIX) ? kind.slice(ACP_GENERIC_PREFIX.length) : undefined;
}

export function registryAdapterKind(agentId: string): string {
  return `${ACP_GENERIC_PREFIX}${agentId}`;
}

export function isEnvVarAuthMethod(
  method: StatusAuthMethod | undefined,
): method is AgentEnvVarAuthMethod {
  return (
    method !== undefined &&
    (method.type === "env_var" || ("vars" in method && Array.isArray(method.vars)))
  );
}

export function isAgentAuthMethod(
  method: StatusAuthMethod | undefined,
): method is AgentOwnedAuthMethod {
  return method !== undefined && !isEnvVarAuthMethod(method) && method.type !== "terminal";
}

export function findAgentAuthMethodForStatus(
  status: AgentStatus | undefined,
): AgentOwnedAuthMethod | undefined {
  return status?.authMethods?.find(isAgentAuthMethod);
}

export function agentAuthTarget(status: AgentStatus): {
  envKind?: AgentStatus["envKind"];
  wslDistro?: string;
} {
  return {
    ...(status.envKind ? { envKind: status.envKind } : {}),
    ...(status.envDistro ? { wslDistro: status.envDistro } : {}),
  };
}

export function scopeEnvForStatus(status: AgentStatus): RefreshAgentScopeEnv {
  return status.envKind === "wsl" && status.envDistro
    ? { kind: "wsl", distro: status.envDistro }
    : { kind: "native" };
}
