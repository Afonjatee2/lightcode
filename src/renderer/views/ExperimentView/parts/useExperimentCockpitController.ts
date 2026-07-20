import { useState } from "react";
import { useShallow } from "zustand/shallow";
import { isThreadResultReady, isThreadTurnActive } from "@/shared/contracts";
import { getProjectAgentStatuses } from "@/shared/agentStatus";
import {
  discardExperiment,
  isEligibleExperimentJudgeAgent,
  retryExperimentCleanup,
} from "@/renderer/actions/experimentActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useThreadLiveWorkflowStore } from "@/renderer/state/threadLiveWorkflowStore";
import { useExperimentJudgeRun } from "./useExperimentJudgeRun";

export type CockpitOperation = "crown" | "merge" | "cleanup" | "discard" | "pr";

export type CockpitOverallStatus = "running" | "ready-to-review" | "completed" | "has-errors";

/**
 * Shared controller behind the experiment cockpit chrome. Both the Board
 * (ExperimentView) and the Compare grid header (ExperimentCompareHeader) drive
 * the same judge/results/cleanup/discard flows, so the eligibility checks,
 * operation locking, judge run state and dialog visibility live here once
 * instead of being duplicated per surface.
 */
export function useExperimentCockpitController(experimentId: string) {
  const experiment = useExperimentStore((state) => state.experiments[experimentId]);
  const [operation, setOperation] = useState<CockpitOperation | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const project = useAppStore((state) =>
    experiment
      ? state.projects.find((candidate) => candidate.id === experiment.projectId)
      : undefined,
  );
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const projectAgents = useAgentStatusesStore(
    useShallow((state) =>
      project
        ? getProjectAgentStatuses(project.location, state.agentStatuses, state.wslAgentStatuses)
        : [],
    ),
  );
  const judgeAgents = projectAgents.filter((agent) =>
    isEligibleExperimentJudgeAgent(agent, disabledAgents),
  );
  const hasAvailableJudge = judgeAgents.length > 0;

  const hasActiveTurn = useAppStore((state) =>
    experiment
      ? state.threads.some(
          (thread) =>
            experiment.candidates.some((candidate) => candidate.threadId === thread.id) &&
            isThreadTurnActive(thread.status),
        )
      : false,
  );
  const hasLiveWorkflow = useThreadLiveWorkflowStore((state) =>
    experiment
      ? experiment.candidates.some((candidate) => state.liveThreadIds.has(candidate.threadId))
      : false,
  );
  const hasActiveCandidate = hasActiveTurn || hasLiveWorkflow;

  // Candidates that have settled with a comparable result (idle/finished, no
  // live workflow). Judging is gated on having at least two of these — a failed
  // or still-running candidate simply doesn't count, so it can never deadlock
  // the "Crown with AI" button the way "wait for EVERY candidate" did.
  const liveThreadIds = useThreadLiveWorkflowStore((state) => state.liveThreadIds);
  const readyThreadIds = useAppStore(
    useShallow((state) =>
      experiment
        ? state.threads
            .filter(
              (thread) =>
                experiment.candidates.some((candidate) => candidate.threadId === thread.id) &&
                isThreadResultReady(thread.status),
            )
            .map((thread) => thread.id)
        : [],
    ),
  );
  const resultReadyCount = readyThreadIds.filter((id) => !liveThreadIds.has(id)).length;
  const hasErrorCandidate = useAppStore((state) =>
    experiment
      ? state.threads.some(
          (thread) =>
            experiment.candidates.some((candidate) => candidate.threadId === thread.id) &&
            thread.status === "error",
        )
      : false,
  );
  const hasCleanupPending =
    experiment?.status === "decided" &&
    experiment.candidates.some((candidate) => candidate.worktreeState !== "removed");

  async function performOperation(kind: CockpitOperation, action: () => void | Promise<void>) {
    if (operation) return;
    setOperation(kind);
    try {
      await action();
    } finally {
      setOperation(null);
    }
  }

  const judge = useExperimentJudgeRun({
    experiment,
    judgeAgents,
    projectAgents,
    runCrown: (action) => void performOperation("crown", action),
  });

  const decided = experiment?.status === "decided";
  const overallStatus: CockpitOverallStatus = decided
    ? "completed"
    : hasErrorCandidate
      ? "has-errors"
      : resultReadyCount >= 2 && !hasActiveCandidate
        ? "ready-to-review"
        : "running";

  return {
    experiment,
    projectAgents,
    judgeAgents,
    judge,
    operation,
    operationLocked: operation !== null,
    performOperation,
    decided: decided ?? false,
    hasAiResults: experiment?.crown?.source === "ai",
    hasAvailableJudge,
    hasActiveCandidate,
    hasCleanupPending: hasCleanupPending ?? false,
    resultReadyCount,
    overallStatus,
    discardConfirmOpen,
    openCrown: judge.open,
    openResults: judge.openResults,
    requestDiscard: () => setDiscardConfirmOpen(true),
    closeDiscardConfirm: () => setDiscardConfirmOpen(false),
    confirmDiscard: () => {
      setDiscardConfirmOpen(false);
      if (!experiment) return;
      const id = experiment.id;
      void performOperation("discard", async () => {
        await discardExperiment(id);
      });
    },
    retryCleanup: () => {
      if (!experiment) return;
      const id = experiment.id;
      void performOperation("cleanup", async () => {
        await retryExperimentCleanup(id);
      });
    },
    close: () => useAppStore.getState().openHome(),
  };
}

export type ExperimentCockpitController = ReturnType<typeof useExperimentCockpitController>;
