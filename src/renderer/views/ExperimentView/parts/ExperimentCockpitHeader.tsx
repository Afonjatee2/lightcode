import { ButtonGroup, Tooltip } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Crown, FlaskConical, LayoutGrid, Loader2, Trash2, X } from "lucide-react";
import type { PromptSegment } from "@/shared/contracts";
import { Button } from "@/renderer/components/common/Button";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import { ExperimentPromptSection } from "./ExperimentPromptSection";
import type { CockpitOperation, CockpitOverallStatus } from "./useExperimentCockpitController";

interface ExperimentCockpitHeaderProps {
  title: string;
  prompt: string;
  segments?: PromptSegment[];
  baseBranch: string;
  candidateCount: number;
  overallStatus: CockpitOverallStatus;
  activeView: "board" | "compare";
  onViewChange: (view: "board" | "compare") => void;
  operationLocked: boolean;
  operation: CockpitOperation | null;
  decided: boolean;
  hasAiResults: boolean;
  hasAvailableJudge: boolean;
  resultReadyCount: number;
  hasActiveCandidate: boolean;
  hasCleanupPending: boolean;
  onCrownOpen: () => void;
  onResultsOpen: () => void;
  onCleanup: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

const STATUS_LABEL_CLASS: Record<CockpitOverallStatus, string> = {
  running: "text-primary",
  "ready-to-review": "text-warning",
  completed: "text-success",
  "has-errors": "text-danger",
};

/**
 * Persistent experiment cockpit chrome, shared by the Board and the Compare
 * grid. Stays purely presentational: all eligibility/operation/dialog state is
 * owned by useExperimentCockpitController on the calling surface. The prompt
 * preview row keeps the full task context visible in both views.
 */
export function ExperimentCockpitHeader(props: ExperimentCockpitHeaderProps) {
  const { t } = useLingui();
  const statusLabel: string = (() => {
    switch (props.overallStatus) {
      case "running":
        return t`Running`;
      case "ready-to-review":
        return t`Ready to review`;
      case "completed":
        return t`Completed`;
      case "has-errors":
        return t`Has errors`;
    }
  })();

  return (
    <div className="shrink-0 border-b border-[var(--hairline)]">
      <div
        className={`poracode-content-over-drag-region ${macosTrafficLightPadClass} min-h-[env(titlebar-area-height,32px)] px-3`}
      >
        <div className="mx-auto flex min-h-[env(titlebar-area-height,32px)] max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
          <FlaskConical className="size-3.5 shrink-0 text-muted" />
          <span className="min-w-0 truncate text-xs font-medium">{props.title}</span>
          <span className="shrink-0 rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted">
            <Plural value={props.candidateCount} one="# candidate" other="# candidates" />
          </span>
          <span
            className={`shrink-0 rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] ${
              STATUS_LABEL_CLASS[props.overallStatus]
            }`}
          >
            {statusLabel}
          </span>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1">
            <ButtonGroup>
              <Button
                size="sm"
                variant={props.activeView === "board" ? "secondary" : "ghost"}
                aria-pressed={props.activeView === "board" ? "true" : "false"}
                className="h-7 px-2 text-xs"
                onPress={() => props.onViewChange("board")}
              >
                <Trans>Board</Trans>
              </Button>
              <Button
                size="sm"
                variant={props.activeView === "compare" ? "secondary" : "ghost"}
                aria-pressed={props.activeView === "compare" ? "true" : "false"}
                className="h-7 px-2 text-xs"
                isDisabled={props.candidateCount < 2}
                onPress={() => props.onViewChange("compare")}
              >
                <LayoutGrid className="size-3.5" />
                <Trans>Compare</Trans>
              </Button>
            </ButtonGroup>
            {props.hasAiResults ? (
              <Button
                size="sm"
                variant="tertiary"
                className="h-7 px-2.5 text-xs"
                isDisabled={props.operation === "crown"}
                onPress={props.onResultsOpen}
              >
                <Crown className="size-3" />
                <Trans>Results</Trans>
              </Button>
            ) : null}
            {!props.decided ? (
              <Tooltip delay={300}>
                <Tooltip.Trigger>
                  <Button
                    size="sm"
                    variant="tertiary"
                    className="h-7 px-2.5 text-xs"
                    isDisabled={
                      props.operationLocked ||
                      props.resultReadyCount < 2 ||
                      !props.hasAvailableJudge
                    }
                    isPending={props.operation === "crown"}
                    onPress={props.onCrownOpen}
                  >
                    {props.operation === "crown" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Crown className="size-3" />
                    )}
                    {props.operation === "crown" ? (
                      <Trans>Judging…</Trans>
                    ) : (
                      <Trans>Crown with AI</Trans>
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {!props.hasAvailableJudge ? (
                    <Trans>None of these agents can run the AI comparison.</Trans>
                  ) : props.resultReadyCount < 2 ? (
                    <Trans>At least two candidates must finish before judging.</Trans>
                  ) : (
                    <Trans>Let an AI judge compare the finished candidates.</Trans>
                  )}
                </Tooltip.Content>
              </Tooltip>
            ) : null}
            {props.decided && props.hasCleanupPending ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-xs"
                isDisabled={props.operationLocked || props.hasActiveCandidate}
                isPending={props.operation === "cleanup"}
                onPress={props.onCleanup}
              >
                <Trans>Retry cleanup</Trans>
              </Button>
            ) : null}
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={props.operation === "discard"}
              aria-label={t`Discard experiment`}
              className="size-6 min-w-0 text-muted hover:text-danger"
              onPress={props.onDiscard}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={props.operation === "merge" || props.operation === "discard"}
              aria-label={t`Close experiment`}
              className="size-6 min-w-0 text-muted"
              onPress={props.onClose}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="mx-auto max-w-5xl">
          <ExperimentPromptSection
            compact
            prompt={props.prompt}
            {...(props.segments ? { segments: props.segments } : {})}
            baseBranch={props.baseBranch}
          />
        </div>
      </div>
    </div>
  );
}
