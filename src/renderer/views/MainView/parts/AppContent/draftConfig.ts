import type { ProjectDraftConfig, ThreadConfig } from "@/shared/contracts";

export function buildProjectDraftConfig(input: {
  agentKind: ProjectDraftConfig["agentKind"];
  config: ThreadConfig;
  worktreeMode: boolean;
}): ProjectDraftConfig {
  const { agentKind, config, worktreeMode } = input;

  return {
    agentKind,
    model: config.model,
    ...(config.effort !== undefined ? { effort: config.effort } : {}),
    ...(config.contextSize ? { contextSize: config.contextSize } : {}),
    ...(config.fast === true ? { fast: true } : {}),
    ...(config.thinking === true ? { thinking: true } : {}),
    ...(config.mode ? { mode: config.mode } : {}),
    ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
    ...(config.sandboxMode ? { sandboxMode: config.sandboxMode } : {}),
    worktreeMode,
  };
}
