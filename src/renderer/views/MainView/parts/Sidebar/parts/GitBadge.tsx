import { GitPullRequest } from "lucide-react";
import { useGitStore } from "@/renderer/state/gitStore";
import { buildBranchPrKey } from "@/renderer/state/gitSelectors";
import { useShallow } from "zustand/shallow";
import { handleKeyActivate } from "@/renderer/utils/a11y";
import { getPrStatusTone, PR_TONE_TEXT_CLASS } from "@/renderer/utils/prStatus";

export function GitBadge(props: {
  projectId: string;
  projectName: string;
  onPress?: () => void;
  worktreePath?: string;
  isActive?: boolean;
}) {
  const { isRepo, totalInsertions, totalDeletions, prState, checksStatus } = useGitStore(
    useShallow((s) => {
      const gitStatus = props.worktreePath
        ? s.worktreeStatuses[props.worktreePath]
        : s.statuses[props.projectId];
      const pr = props.worktreePath
        ? s.prData[props.worktreePath]
        : s.prData[buildBranchPrKey(props.projectId)];
      return {
        isRepo: gitStatus?.isRepo ?? false,
        totalInsertions: gitStatus?.totalInsertions ?? 0,
        totalDeletions: gitStatus?.totalDeletions ?? 0,
        prState: pr?.state,
        checksStatus: pr?.checksStatus,
      };
    }),
  );
  const hasChanges = totalInsertions > 0 || totalDeletions > 0;
  const hasOpenPr = prState !== undefined && prState !== "closed" && prState !== "merged";
  if (!isRepo || (!hasChanges && !hasOpenPr)) return null;
  const prIconColor = PR_TONE_TEXT_CLASS[getPrStatusTone(prState, checksStatus)];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Git status for ${props.projectName}`}
      className={`shrink-0 cursor-default rounded px-1 py-0.5 transition-colors hover:bg-white/[0.04] hover:text-foreground ${
        props.isActive ? "bg-accent/15 ring-1 ring-accent/40" : "text-muted/60"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        props.onPress?.();
      }}
      onKeyDown={(e) => handleKeyActivate(e, () => props.onPress?.(), { stopPropagation: true })}
    >
      <span className="flex items-center gap-1 text-[10px] font-medium">
        {hasOpenPr && <GitPullRequest className={`size-3 ${prIconColor}`} />}
        {hasChanges && (
          <span className="flex items-center gap-0.5">
            {totalInsertions > 0 && <span className="text-success">+{totalInsertions}</span>}
            {totalDeletions > 0 && <span className="text-danger">-{totalDeletions}</span>}
          </span>
        )}
      </span>
    </div>
  );
}
