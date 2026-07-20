import { useEffect, useState } from "react";
import { ButtonGroup, Dropdown, Label, Tooltip } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  CheckCircle2,
  ChevronDown,
  Crown,
  ExternalLink,
  FileDiff,
  GitMerge,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import { isThreadResultReady, isThreadTurnActive } from "@/shared/contracts";
import type { ExperimentCandidate, GetExperimentCandidateStatsResult } from "@/shared/contracts";
import { buildWorktreeLocation } from "@/shared/worktree";
import { showGitReviewPanel } from "@/renderer/actions/panelActions";
import { readBridge } from "@/renderer/bridge";
import { Button } from "@/renderer/components/common/Button";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";
import { ThreadProviderIcon } from "@/renderer/components/providers/ThreadProviderIcon";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { useThreadHasLiveWorkflow } from "@/renderer/state/threadLiveWorkflowStore";
import { useThread } from "@/renderer/state/useThread";
import { getPrStatusTone, PR_TONE_TEXT_CLASS } from "@/renderer/utils/prStatus";

type CandidateStatsState = GetExperimentCandidateStatsResult | "loading" | "unavailable";

const candidateStatsCache = new Map<string, GetExperimentCandidateStatsResult | "unavailable">();

export function ExperimentCandidateCard(props: {
  candidate: ExperimentCandidate;
  candidateNumber: number;
  baseCommit: string;
  configLabel: string;
  isCrowned: boolean;
  isWinner: boolean;
  decided: boolean;
  operationLocked: boolean;
  hasActiveCandidate: boolean;
  isCreatingPr: boolean;
  isMerging: boolean;
  onOpen: () => void;
  onCrown: () => void;
  onMerge: () => void;
  onCreatePr: () => void;
}) {
  const { candidate, isCrowned, isWinner, decided } = props;
  const { t } = useLingui();
  const thread = useThread(candidate.threadId);
  const hasLiveWorkflow = useThreadHasLiveWorkflow(candidate.threadId);
  const isActive =
    hasLiveWorkflow || thread?.status === "launching" || thread?.status === "working";
  const projectId = thread?.projectId;
  const projectLocation = useAppStore(
    (state) => state.projects.find((project) => project.id === projectId)?.location,
  );
  const worktreePath = thread?.worktreePath ?? candidate.worktreePath;
  // gitStore preserves referential equality when status content is unchanged.
  const worktreeStatus = useGitStore((state) =>
    worktreePath ? state.worktreeStatuses[worktreePath] : undefined,
  );
  const pullRequest = useGitStore((state) =>
    worktreePath ? state.prData[worktreePath] : undefined,
  );
  const prNumber = pullRequest?.number ?? thread?.prNumber;
  const hasPullRequest = prNumber !== undefined && pullRequest?.state !== "closed";
  const prIconClass =
    PR_TONE_TEXT_CLASS[getPrStatusTone(pullRequest?.state, pullRequest?.checksStatus)];
  const statsCacheKey = worktreePath ? `${worktreePath}\0${props.baseCommit}` : "";
  const [stats, setStats] = useState<CandidateStatsState>("loading");
  useEffect(() => {
    if (!projectLocation || !worktreePath) {
      setStats(candidate.worktreeState === "pending" ? "loading" : "unavailable");
      return;
    }
    let cancelled = false;
    const cached = candidateStatsCache.get(statsCacheKey);
    if (cached) setStats(cached);
    void readBridge()
      .getExperimentCandidateStats({
        projectLocation: buildWorktreeLocation(projectLocation, worktreePath),
        baseRef: props.baseCommit,
      })
      .then((nextStats) => {
        candidateStatsCache.set(statsCacheKey, nextStats);
        if (!cancelled) setStats(nextStats);
      })
      .catch(() => {
        if (!candidateStatsCache.has(statsCacheKey)) {
          candidateStatsCache.set(statsCacheKey, "unavailable");
          if (!cancelled) setStats("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    candidate.worktreeState,
    isActive,
    projectLocation,
    props.baseCommit,
    statsCacheKey,
    worktreePath,
    worktreeStatus,
  ]);
  const provider = candidate.agentLabel ?? candidate.agentKind;
  const label = props.configLabel || provider;
  const details = props.configLabel ? provider : "";
  // isThreadTurnActive keeps needs_reply / needs_approval counted as running
  // after hydration, when no live workflow id exists for the thread yet.
  const statusLabel = (() => {
    if (!thread || thread.status === "launching") return "queued" as const;
    if (thread.status === "error") return "failed" as const;
    if (isActive || isThreadTurnActive(thread.status)) return "running" as const;
    if (isThreadResultReady(thread.status)) return "completed" as const;
    return "queued" as const;
  })();
  const worktreeUnavailable = candidate.worktreeState === "removed";
  const canReviewChanges =
    Boolean(projectId && worktreePath) && typeof stats === "object" && stats.files > 0;
  const reviewDisabledReason =
    !projectId || !worktreePath
      ? t`The worktree for this candidate is not available.`
      : stats === "unavailable"
        ? t`Change data is unavailable for this candidate.`
        : !canReviewChanges
          ? t`There are no reviewable changes yet.`
          : "";

  function openReview() {
    if (projectId && worktreePath) showGitReviewPanel(projectId, worktreePath);
  }

  const crownIcon =
    isCrowned || isWinner ? (
      <Crown className="size-3.5 shrink-0 text-warning" aria-label={t`Crowned`} />
    ) : null;
  return (
    <div
      className={`group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--hairline)] bg-surface-secondary/20 px-4 py-3 transition-colors hover:bg-default-100/60 ${
        isWinner ? "border-success/40 bg-success/5" : ""
      }`}
    >
      {thread ? (
        <ThreadProviderIcon thread={thread} className="size-4 shrink-0" />
      ) : (
        <span className="block size-4 shrink-0" />
      )}
      <div className="min-w-56 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="truncate text-left text-sm font-medium text-foreground outline-none hover:underline focus-visible:underline"
            aria-label={t`Open candidate ${props.candidateNumber}: ${label}`}
            onClick={props.onOpen}
          >
            {label}
          </button>
          {crownIcon}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
          <span
            className="shrink-0 tabular-nums"
            aria-label={t`Candidate ${props.candidateNumber}`}
          >
            #{props.candidateNumber}
          </span>
          <span className="text-muted/40" aria-hidden="true">
            ·
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              statusLabel === "running"
                ? "bg-primary/10 text-primary"
                : statusLabel === "completed"
                  ? "bg-success/10 text-success"
                  : statusLabel === "failed"
                    ? "bg-danger/10 text-danger"
                    : "bg-surface-secondary text-muted"
            }`}
          >
            {statusLabel === "queued"
              ? t`Queued`
              : statusLabel === "running"
                ? t`Running`
                : statusLabel === "completed"
                  ? t`Completed`
                  : t`Failed`}
          </span>
          {statusLabel === "completed" ? (
            <CheckCircle2 className="size-3 shrink-0 text-success" aria-label={t`Result ready`} />
          ) : null}
          {details ? (
            <>
              <span className="shrink-0 truncate">{details}</span>
              <span className="text-muted/40" aria-hidden="true">
                ·
              </span>
            </>
          ) : null}
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              {/* The Tooltip.Trigger wrapper is keyboard-focusable, so the full
                  branch stays reachable without a mouse; title is a fallback. */}
              <span
                title={candidate.worktreeBranch}
                className="truncate font-mono text-[11px] cursor-default rounded"
              >
                {shortenBranch(candidate.worktreeBranch)}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content className="font-mono text-xs">
              {candidate.worktreeBranch}
            </Tooltip.Content>
          </Tooltip>
          {thread ? (
            <>
              <span className="text-muted/40" aria-hidden="true">
                ·
              </span>
              <RelativeTime iso={thread.updatedAt} className="shrink-0 tabular-nums" />
            </>
          ) : null}
          {worktreeUnavailable ? (
            <>
              <span className="text-muted/40" aria-hidden="true">
                ·
              </span>
              <span className="shrink-0 text-[11px] text-warning">
                <Trans>Worktree removed</Trans>
              </span>
            </>
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            aria-label={t`Open candidate ${props.candidateNumber}`}
            onPress={props.onOpen}
          >
            <ExternalLink className="size-3" />
            <Trans>Open</Trans>
          </Button>
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                aria-label={t`Review candidate ${props.candidateNumber} changes`}
                isDisabled={!canReviewChanges}
                onPress={openReview}
              >
                <FileDiff className="size-3" />
                <Trans>Review changes</Trans>
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              {reviewDisabledReason || <Trans>Open the Git review panel for this candidate.</Trans>}
            </Tooltip.Content>
          </Tooltip>
          {!decided && !isCrowned ? (
            <Button
              size="sm"
              variant="tertiary"
              className="h-6 px-2 text-xs"
              aria-label={t`Select candidate ${props.candidateNumber} (${label}) as winner`}
              isDisabled={props.operationLocked || props.hasActiveCandidate}
              onPress={props.onCrown}
            >
              <Crown className="size-3" />
              <Trans>Crown</Trans>
            </Button>
          ) : null}
        </div>
      </div>

      {typeof stats === "object" && stats.files > 0 ? (
        <button
          type="button"
          className="flex shrink-0 cursor-pointer flex-col items-end gap-0.5 rounded px-1.5 py-1 text-right text-[11px] transition-colors hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-label={t`Review candidate ${props.candidateNumber} (${label}) changes`}
          onClick={openReview}
        >
          <span className="flex items-center gap-1 font-medium tabular-nums">
            <span className="text-success">+{stats.insertions}</span>
            <span className="text-danger">−{stats.deletions}</span>
          </span>
          <span className="text-muted">
            <Plural value={stats.files} one="# file" other="# files" />
          </span>
        </button>
      ) : typeof stats === "object" ? (
        <span className="shrink-0 text-[11px] text-muted">
          {statusLabel === "completed" ? (
            <Trans>Completed · no changes</Trans>
          ) : statusLabel === "running" ? (
            <Trans>Running · no changes yet</Trans>
          ) : (
            <Trans>No changes yet</Trans>
          )}
        </span>
      ) : stats === "unavailable" ? (
        <span className="shrink-0 text-[11px] text-muted">
          <Trans>Changes unavailable</Trans>
        </span>
      ) : null}

      <div className="flex shrink-0 items-center gap-1.5">
        {!decided && isCrowned ? (
          <ButtonGroup>
            {props.isMerging ? (
              <Button
                size="sm"
                variant="primary"
                className="h-7 px-2.5 text-xs"
                aria-label={t`Merge winner`}
                isDisabled
                isPending
              >
                <Loader2 className="size-3.5 animate-spin" />
                <Trans>Merge winner</Trans>
              </Button>
            ) : hasPullRequest ? (
              <Button
                isIconOnly
                size="sm"
                variant="primary"
                className="h-7"
                aria-label={t`Open PR #${prNumber}`}
                isDisabled={props.operationLocked || !projectId || !worktreePath}
                onPress={openReview}
              >
                <GitPullRequest className={`size-3.5 ${prIconClass}`} />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                className="h-7 px-2.5 text-xs"
                aria-label={t`Create a pull request for candidate ${props.candidateNumber} (${label})`}
                isDisabled={props.operationLocked || props.hasActiveCandidate}
                isPending={props.isCreatingPr}
                onPress={props.onCreatePr}
              >
                {props.isCreatingPr ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <GitPullRequest className="size-3.5" />
                )}
                <Trans>Create PR</Trans>
              </Button>
            )}
            <Dropdown>
              <Button
                isIconOnly
                size="sm"
                variant="primary"
                className="h-7"
                aria-label={t`More actions for candidate ${props.candidateNumber} (${label})`}
                isDisabled={props.operationLocked || props.hasActiveCandidate}
              >
                <ButtonGroup.Separator />
                <ChevronDown className="size-3.5" />
              </Button>
              <Dropdown.Popover placement="bottom end" className="w-64">
                <Dropdown.Menu
                  aria-label={t`Candidate actions`}
                  onAction={(key) => {
                    if (key === "merge") props.onMerge();
                  }}
                >
                  <Dropdown.Item id="merge" textValue={t`Merge winner`}>
                    <GitMerge className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Label>
                        <Trans>Merge winner</Trans>
                      </Label>
                      <span className="whitespace-normal text-xs text-muted">
                        <Trans>
                          Merge this candidate's changes into the base branch and remove the other
                          candidates' worktrees.
                        </Trans>
                      </span>
                    </div>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </ButtonGroup>
        ) : null}
        {isWinner ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
            <GitMerge className="size-3.5" />
            <Trans>Merged</Trans>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function shortenBranch(branch: string): string {
  if (branch.length <= 30) return branch;
  const parts = branch.split("/");
  const last = parts[parts.length - 1] ?? branch;
  const prefix = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
  if (prefix.length + last.length <= 30) return branch;
  return `${prefix}${last.slice(0, 12)}…${last.slice(-6)}`;
}
