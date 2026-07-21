import { DEFAULT_TERMINAL_SIZE } from "@/shared/contracts";
import { getProjectAgentStatuses } from "@/shared/agentStatus";
import { buildWorktreeLocation } from "@/shared/worktree";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveModelValue, resolveEffortValue, resolveFastValue } from "@/renderer/components/thread/threadDraftViewHelpers";
import { isEligibleExperimentJudgeAgent } from "./experimentOperationState";
import { closeExperimentThread } from "./experimentWorktreeActions";
import { performInitialThreadLaunch } from "./threadLaunchActions";

const fallbackCursors = new Map<string, number>();
const inFlightOperations = new Set<string>();

/** Test-only: clears the module-level fallback cursors and in-flight guards. */
export function __resetExperimentFallbackState(): void {
  fallbackCursors.clear();
  inFlightOperations.clear();
}

export function maybeAdvanceExperimentFallback(threadId: string): void | Promise<void> {
  if (inFlightOperations.has(threadId)) return;

  const experiment = Object.values(useExperimentStore.getState().experiments).find((item) =>
    item.candidates.some((c) => c.threadId === threadId),
  );
  if (!experiment) return;
  if (experiment.status !== "running") return;

  const candidate = experiment.candidates.find((c) => c.threadId === threadId);
  if (!candidate?.fallbackChain?.length) return;
  if (candidate.worktreeState !== "owned" || !candidate.worktreePath) return;

  const cursor = fallbackCursors.get(threadId) ?? 0;
  if (cursor >= candidate.fallbackChain.length) return;

  const project = useAppStore
    .getState()
    .projects.find((item) => item.id === experiment.projectId);
  if (!project) return;

  const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
  const projectAgentStatuses = getProjectAgentStatuses(
    project.location,
    agentStatuses,
    wslAgentStatuses,
  );
  const disabledAgents = useSharedSettings.getState().disabledAgents;

  let nextAgentKind: string | undefined;
  for (let i = cursor; i < candidate.fallbackChain.length; i++) {
    const kind = candidate.fallbackChain[i]!;
    const agent = projectAgentStatuses.find((a) => a.kind === kind);
    if (agent && isEligibleExperimentJudgeAgent(agent, disabledAgents)) {
      nextAgentKind = kind;
      fallbackCursors.set(threadId, i + 1);
      break;
    }
  }

  if (!nextAgentKind) {
    fallbackCursors.set(threadId, candidate.fallbackChain.length);
    return;
  }

  const nextAgent = projectAgentStatuses.find((a) => a.kind === nextAgentKind)!;
  const nextModel = resolveModelValue(nextAgent);
  const nextEffort = resolveEffortValue(nextAgent, nextModel);
  const nextFast = resolveFastValue(nextAgent, nextModel);
  const nextConfig = {
    model: nextModel,
    ...(nextEffort ? { effort: nextEffort } : {}),
    ...(nextFast ? { fast: nextFast } : {}),
  };

  const thread = useAppStore.getState().threads.find((t) => t.id === threadId);
  if (!thread) return;

  inFlightOperations.add(threadId);

  return (async () => {
    try {
      const closed = await closeExperimentThread(threadId);
      if (!closed) return;
      useAppStore.getState().setThreadAgentKind(threadId, nextAgentKind, nextConfig);
      useExperimentStore.getState().updateCandidateAgent(experiment.id, threadId, nextAgentKind);
      const updatedThread = useAppStore.getState().threads.find((t) => t.id === threadId);
      if (!updatedThread) {
        throw new Error("thread disappeared during fallback");
      }
      await performInitialThreadLaunch({
        thread: updatedThread,
        projectLocation: buildWorktreeLocation(project.location, candidate.worktreePath!),
        prompt: experiment.prompt,
        ...(experiment.segments ? { segments: experiment.segments } : {}),
        initialSize: DEFAULT_TERMINAL_SIZE,
      });
      // launchExperiment errors are intentionally not handled here —
      // the fallback path only covers candidates that already own a worktree;
      // launch-time failures are out of v1 scope.
    } catch {
      console.error("[experiment] fallback relaunch failed for thread", threadId);
    } finally {
      inFlightOperations.delete(threadId);
    }
  })();
}
