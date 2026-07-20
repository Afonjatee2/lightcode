import type { AgentStatus, ProjectLocation } from "@/shared/contracts";
import { resolveAiLanguageName } from "@/shared/locale";
import { readBridge } from "@/renderer/bridge";
import { detectOSLocale } from "@/renderer/i18n/locales";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

export interface RequestExecutorSpecInput {
  projectLocation: ProjectLocation;
  /** The orchestrator agent the user picked in the draft dialog. */
  agent: AgentStatus;
  model?: string | undefined;
  effort?: string | undefined;
  fast?: boolean | undefined;
  task: string;
}

/**
 * Draft an executor spec from a short task using an explicitly-chosen agent.
 * Unlike title generation there is no provider-fallback indirection — the user
 * picks the orchestrator agent + model in the draft dialog, so this is a thin
 * wrapper over the `generateExecutorSpec` bridge call.
 */
export async function requestExecutorSpec(input: RequestExecutorSpecInput): Promise<string> {
  const settings = useSharedSettings.getState();
  const language = resolveAiLanguageName("match-app", settings.locale, detectOSLocale());
  const result = await readBridge().generateExecutorSpec({
    projectLocation: input.projectLocation,
    agentKind: input.agent.kind,
    task: input.task,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.fast !== undefined ? { fast: input.fast } : {}),
    ...(language ? { language } : {}),
  });
  return result.spec;
}
