import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  createExperimentCandidatePr,
  mergeExperimentWinner,
  setExternalExperimentCrown,
  setManualExperimentCrown,
} from "@/renderer/actions/experimentActions";
import { formatModelConfigLabel } from "@/renderer/components/providers/modelDisplay";
import { openThread } from "@/renderer/actions/threadActions";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { useAppStore } from "@/renderer/state/appStore";
import { HomeView } from "@/renderer/views/HomeView";
import { ExperimentCandidateCard } from "./parts/ExperimentCandidateCard";
import { ExperimentCockpitDialogs } from "./parts/ExperimentCockpitDialogs";
import { ExperimentCockpitHeader } from "./parts/ExperimentCockpitHeader";
import { useExperimentCockpitController } from "./parts/useExperimentCockpitController";

type Confirmation = { kind: "merge" } | null;

export function ExperimentView(props: { experimentId: string }) {
  const { t } = useLingui();
  const controller = useExperimentCockpitController(props.experimentId);
  const experiment = controller.experiment;
  const projectAgents = controller.projectAgents;
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [activeView, setActiveView] = useState<"board" | "compare">("board");

  useEffect(() => {
    if (!experiment) return;
    const threadById = new Map(
      useAppStore.getState().threads.map((thread) => [thread.id, thread] as const),
    );
    const nextTitles = new Map<string, string>();
    for (const candidate of experiment.candidates) {
      const thread = threadById.get(candidate.threadId);
      const provider = candidate.agentLabel ?? candidate.agentKind;
      const model = formatModelConfigLabel(
        projectAgents.find((agent) => agent.kind === candidate.agentKind),
        candidate,
      );
      if (model && thread?.title === `${provider} · ${model}`) {
        nextTitles.set(thread.id, `${model} · ${provider}`);
      }
    }
    if (nextTitles.size > 0) {
      const updatedAt = new Date().toISOString();
      useAppStore.setState((state) => ({
        threads: state.threads.map((thread) => {
          const title = nextTitles.get(thread.id);
          return title ? { ...thread, title, updatedAt } : thread;
        }),
      }));
    }
  }, [experiment, projectAgents]);

  if (!experiment) return <HomeView />;

  const exp = experiment;
  const candidates = exp.candidates;
  const decided = controller.decided;
  const hasCleanupPending = controller.hasCleanupPending;
  const crownThreadId = exp.crown?.threadId;
  const crownedCandidate = candidates.find((candidate) => candidate.threadId === crownThreadId);
  const isMergeEligible =
    exp.crown?.source !== "external" || exp.crown.verdict === "approve";

  function confirmMerge() {
    setConfirmation(null);
    void controller.performOperation("merge", async () => {
      await mergeExperimentWinner(exp.id);
    });
  }

  const loserCount = Math.max(candidates.length - 1, 0);
  const mergeTarget = exp.baseBranch;
  const crownedProvider = crownedCandidate?.agentLabel ?? crownedCandidate?.agentKind;
  const crownedModel = crownedCandidate
    ? formatModelConfigLabel(
        projectAgents.find((agent) => agent.kind === crownedCandidate.agentKind),
        crownedCandidate,
      )
    : "";
  const crownedLabel = crownedModel
    ? `${crownedModel} · ${crownedProvider}`
    : (crownedProvider ?? t`the winner`);

  return (
    <div className="flex h-full flex-col">
      <ExperimentCockpitHeader
        title={exp.title}
        prompt={exp.prompt}
        {...(exp.segments ? { segments: exp.segments } : {})}
        baseBranch={exp.baseBranch}
        candidateCount={candidates.length}
        overallStatus={controller.overallStatus}
        activeView={activeView}
        onViewChange={(view) => {
          if (view === "compare") {
            useAppStore.getState().openGroupGrid(exp.id);
          }
          setActiveView(view);
        }}
        operationLocked={controller.operationLocked}
        operation={controller.operation}
        decided={decided}
        hasAiResults={controller.hasAiResults}
        hasAvailableJudge={controller.hasAvailableJudge}
        resultReadyCount={controller.resultReadyCount}
        hasActiveCandidate={controller.hasActiveCandidate}
        hasCleanupPending={hasCleanupPending}
        onCrownOpen={controller.openCrown}
        onResultsOpen={controller.openResults}
        onCleanup={controller.retryCleanup}
        onDiscard={controller.requestDiscard}
        onClose={controller.close}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {decided ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                hasCleanupPending
                  ? "border-warning/40 bg-warning/5 text-warning"
                  : "border-success/40 bg-success/5 text-success"
              }`}
            >
              {hasCleanupPending ? (
                <Trans>Some losing worktrees could not be removed.</Trans>
              ) : (
                <Trans>Winner merged.</Trans>
              )}
            </div>
          ) : null}

          <div className="flex min-w-0 flex-col gap-2">
            {candidates.map((candidate, index) => {
              const candidateAgent = projectAgents.find(
                (agent) => agent.kind === candidate.agentKind,
              );
              const configLabel = formatModelConfigLabel(candidateAgent, candidate);
              return (
                <ExperimentCandidateCard
                  key={candidate.threadId}
                  candidate={candidate}
                  candidateNumber={index + 1}
                  baseCommit={exp.baseCommit}
                  configLabel={configLabel}
                  isCrowned={crownThreadId === candidate.threadId}
                  isWinner={exp.winnerThreadId === candidate.threadId}
                  decided={decided}
                  operationLocked={controller.operationLocked}
                  hasActiveCandidate={controller.hasActiveCandidate}
                  isCreatingPr={controller.operation === "pr"}
                  isMerging={controller.operation === "merge"}
                  isMergeEligible={isMergeEligible}
                  onOpen={() => openThread(candidate.threadId)}
                  onCrown={() =>
                    void controller.performOperation("crown", () =>
                      setManualExperimentCrown(exp.id, candidate.threadId),
                    )
                  }
                  onExternalVerdict={(verdict, note) =>
                    setExternalExperimentCrown(exp.id, candidate.threadId, verdict, note)
                  }
                  {...(exp.crown?.source === "external" &&
                  exp.crown.threadId === candidate.threadId
                    ? {
                        externalVerdict: {
                          verdict: exp.crown.verdict,
                          ...(exp.crown.note ? { note: exp.crown.note } : {}),
                        },
                      }
                    : {})}
                  onMerge={() => setConfirmation({ kind: "merge" })}
                  onCreatePr={() =>
                    void controller.performOperation("pr", async () => {
                      await createExperimentCandidatePr(exp.id, candidate.threadId);
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

      <ExperimentCockpitDialogs controller={controller} />

      <ConfirmDialog
        isOpen={confirmation?.kind === "merge"}
        title={t`Merge experiment winner?`}
        confirmLabel={t`Merge winner`}
        confirmVariant="primary"
        status="warning"
        body={
          <div className="space-y-2 text-sm text-muted">
            <p>
              <Trans>
                Merge {crownedLabel}'s changes into {mergeTarget}?
              </Trans>
            </p>
            {loserCount > 0 ? (
              <p>
                <Trans>
                  Losing worktrees and branches will be removed. Their session history will remain.
                </Trans>
              </p>
            ) : null}
          </div>
        }
        onConfirm={confirmMerge}
        onClose={() => setConfirmation(null)}
      />
    </div>
  );
}
