import { Trans, useLingui } from "@lingui/react/macro";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { ExperimentJudgeDialog } from "./ExperimentJudgeDialog";
import { ExperimentJudgeRunDialog } from "./ExperimentJudgeRunDialog";
import type { ExperimentCockpitController } from "./useExperimentCockpitController";

/**
 * Dialog host shared by the Board and the Compare grid header. Renders the
 * judge configuration dialog, the live judge run / saved results dialog and
 * the discard confirmation from the shared controller state, so both surfaces
 * open the exact same flows without duplicating any dialog wiring.
 */
export function ExperimentCockpitDialogs(props: { controller: ExperimentCockpitController }) {
  const { controller } = props;
  const { t } = useLingui();

  return (
    <>
      {controller.judge.config ? (
        <ExperimentJudgeDialog
          agents={controller.judgeAgents}
          config={controller.judge.config}
          onChange={controller.judge.setConfig}
          onConfirm={controller.judge.confirm}
          onClose={() => controller.judge.setConfig(null)}
        />
      ) : null}

      {controller.judge.run ? (
        <ExperimentJudgeRunDialog
          run={controller.judge.run}
          onCancel={controller.judge.cancel}
          onClose={() => controller.judge.setRun(null)}
        />
      ) : null}

      <ConfirmDialog
        isOpen={controller.discardConfirmOpen}
        title={t`Discard experiment?`}
        confirmLabel={t`Discard experiment`}
        body={
          <p className="text-sm text-muted">
            <Trans>All candidate sessions, worktrees, and branches will be removed.</Trans>
          </p>
        }
        onConfirm={controller.confirmDiscard}
        onClose={controller.closeDiscardConfirm}
      />
    </>
  );
}
