import { useAppStore } from "@/renderer/state/appStore";
import { ExperimentCockpitDialogs } from "./ExperimentCockpitDialogs";
import { ExperimentCockpitHeader } from "./ExperimentCockpitHeader";
import { useExperimentCockpitController } from "./useExperimentCockpitController";

/**
 * Cockpit chrome shown above the Compare grid (thread view with an experiment
 * group active). Crown with AI and Results open the same judge configuration
 * / saved results flows the Board uses — directly, without navigating back to
 * the Board first. Only the Board button changes the view; nothing here
 * relaunches candidates or mutates candidate state.
 */
export function ExperimentCompareHeader(props: { experimentId: string }) {
  const controller = useExperimentCockpitController(props.experimentId);
  const experiment = controller.experiment;

  if (!experiment) return null;

  return (
    <>
      <ExperimentCockpitHeader
        title={experiment.title}
        prompt={experiment.prompt}
        {...(experiment.segments ? { segments: experiment.segments } : {})}
        baseBranch={experiment.baseBranch}
        candidateCount={experiment.candidates.length}
        overallStatus={controller.overallStatus}
        activeView="compare"
        onViewChange={(view) => {
          if (view === "board") {
            useAppStore.getState().openExperiment(experiment.id, experiment.projectId);
          }
        }}
        operationLocked={controller.operationLocked}
        operation={controller.operation}
        decided={controller.decided}
        hasAiResults={controller.hasAiResults}
        hasAvailableJudge={controller.hasAvailableJudge}
        resultReadyCount={controller.resultReadyCount}
        hasActiveCandidate={controller.hasActiveCandidate}
        hasCleanupPending={controller.hasCleanupPending}
        onCrownOpen={controller.openCrown}
        onResultsOpen={controller.openResults}
        onCleanup={controller.retryCleanup}
        onDiscard={controller.requestDiscard}
        onClose={controller.close}
      />
      <ExperimentCockpitDialogs controller={controller} />
    </>
  );
}
