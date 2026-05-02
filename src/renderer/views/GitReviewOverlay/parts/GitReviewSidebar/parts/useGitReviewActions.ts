import { useState } from "react";
import { toast } from "@heroui/react";
import type { GitBranchInfo, GitStatusResult, Project, ProjectLocation } from "@/shared/contracts";
import { getProjectAgentStatuses } from "@/shared/agentStatus";
import { buildWorktreeLocation } from "@/shared/worktree";
import { msg, friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  generateCommitMessageWithFallback,
  getCommitGenCandidates,
  resolveCommitGenConfig,
} from "@/renderer/components/providers";
import { usePrWriteActions } from "@/renderer/hooks/usePrWriteActions";

export interface UseGitReviewActionsArgs {
  project: Project;
  gitStatus: GitStatusResult | null | undefined;
  worktreeBranch: string | undefined;
  worktreePath: string | undefined;
  storeKey: string;
  isWorktreeStatus: boolean;
  onRefresh: () => void;
  onMergeAndRemove: (() => void) | undefined;
  effectiveBranch: string | undefined;
  effectivePrKey: string | undefined;
  sourceBranch: string | null;
  branchList: readonly GitBranchInfo[];
}

export function useGitReviewActions(args: UseGitReviewActionsArgs) {
  const {
    project,
    gitStatus,
    worktreeBranch,
    worktreePath,
    storeKey,
    isWorktreeStatus,
    onRefresh,
    onMergeAndRemove,
    effectiveBranch,
    effectivePrKey,
    sourceBranch,
  } = args;

  // Apply an in-place tweak to the cached status. Used by post-action
  // optimistic updates so the UI flips immediately instead of waiting on a
  // `git status` round-trip — particularly slow on WSL (~500ms–1s per
  // wsl.exe spawn).
  function applyStatusOptimistic(updater: (current: GitStatusResult) => GitStatusResult): void {
    const store = useGitStore.getState();
    const current = isWorktreeStatus ? store.worktreeStatuses[storeKey] : store.statuses[storeKey];
    if (!current) return;
    const next = updater(current);
    if (isWorktreeStatus) store.setWorktreeStatus(storeKey, next);
    else store.setStatus(storeKey, next);
  }

  const isWsl = project.location.kind === "wsl";
  const commitGenProvider = useSharedSettings((s) =>
    isWsl ? s.wslCommitGenProvider : s.commitGenProvider,
  );
  const commitGenModel = useSharedSettings((s) => (isWsl ? s.wslCommitGenModel : s.commitGenModel));
  const commitGenEffort = useSharedSettings((s) =>
    isWsl ? s.wslCommitGenEffort : s.commitGenEffort,
  );

  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((s) => s.wslAgentStatuses);
  const projectAgentStatuses = getProjectAgentStatuses(
    project.location,
    agentStatuses,
    wslAgentStatuses,
  );

  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [isPullingFromSource, setIsPullingFromSource] = useState(false);
  const [isAbortingMerge, setIsAbortingMerge] = useState(false);
  const [isFinishingMerge, setIsFinishingMerge] = useState(false);

  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prTargetBranch, setPrTargetBranch] = useState<string | null>(null);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [isGeneratingPr, setIsGeneratingPr] = useState(false);

  const writeActions = usePrWriteActions({
    projectLocation: project.location,
    prKey: effectivePrKey,
    onRefresh,
  });
  const prLoading = isCreatingPr || writeActions.prLoading;

  const hasRemote = gitStatus?.hasRemote ?? false;
  const hasTracking = Boolean(gitStatus?.tracking);
  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;
  const needsPush = hasTracking ? ahead > 0 && behind === 0 : hasRemote;
  const canGenerateMessage =
    getCommitGenCandidates(projectAgentStatuses, commitGenProvider).length > 0;

  function getWorktreeLocation(): ProjectLocation {
    if (!worktreePath) return project.location;
    return buildWorktreeLocation(project.location, worktreePath);
  }

  async function generateMessage(): Promise<string> {
    return generateCommitMessageWithFallback({
      projectLocation: project.location,
      agentStatuses: projectAgentStatuses,
      provider: commitGenProvider,
      model: commitGenModel,
      effort: commitGenEffort,
      invoke: (payload) => readBridge().generateCommitMessage(payload),
    });
  }

  async function handleCommit(addAll: boolean, pushAfter = false): Promise<void> {
    setIsCommitting(true);
    try {
      let message = commitMessage.trim();
      if (!message && canGenerateMessage) {
        setIsGenerating(true);
        try {
          message = await generateMessage();
          setCommitMessage(message);
        } finally {
          setIsGenerating(false);
        }
      }
      if (!message) throw new Error("Commit message is required");
      await readBridge().gitCommit({
        projectLocation: project.location,
        message,
        addAll,
      });
      setCommitMessage("");
      // The new commit makes us one ahead and the staged set is now part of
      // the commit. Reflect that in the store immediately so the push button
      // appears without waiting for a `git status` round-trip.
      applyStatusOptimistic((s) => ({ ...s, ahead: s.ahead + 1, staged: [] }));

      if (pushAfter && hasRemote) {
        setIsSyncing(true);
        try {
          await readBridge().gitPush({
            projectLocation: project.location,
            setUpstream: !hasTracking,
          });
          applyStatusOptimistic((s) => ({ ...s, ahead: 0 }));
          // GitHub takes a beat to register the new commits — refreshing
          // immediately fetches a stale PR snapshot. Delay so the post-push
          // refresh picks up fresh state.
          setTimeout(() => onRefresh(), 1500);
        } finally {
          setIsSyncing(false);
        }
        return;
      }

      onRefresh();
      // `git fetch` only updates `behind`, which doesn't gate the push UI.
      // Run it in the background so the user isn't blocked on a wsl.exe
      // network call (1–2s on WSL).
      readBridge()
        .gitFetch({ projectLocation: project.location, remote: "origin", prune: false })
        .catch(() => undefined)
        .finally(() => onRefresh());
    } catch (err) {
      console.error("[git] commit failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleGenerateMessage(): Promise<void> {
    setIsGenerating(true);
    try {
      const message = await generateMessage();
      setCommitMessage(message);
    } catch (err) {
      console.error("[git] generate message failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSyncOrPush(): Promise<void> {
    setIsSyncing(true);
    try {
      if (needsPush) {
        await readBridge().gitPush({
          projectLocation: project.location,
          setUpstream: !hasTracking,
        });
        // Optimistic: a successful push clears `ahead`. The refresh below
        // confirms it a moment later.
        applyStatusOptimistic((s) => ({ ...s, ahead: 0 }));
        // GitHub takes a beat to register the new commits — refreshing
        // immediately fetches a stale PR snapshot (mergeable/checks not
        // yet updated). Delay so the post-push refresh picks up fresh state.
        setTimeout(() => onRefresh(), 1500);
      } else {
        await readBridge().gitSync({ projectLocation: project.location });
        onRefresh();
      }
    } catch (err) {
      console.error("[git] sync/push failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleSyncAction(
    key: "pull" | "pullRebase" | "push" | "sync" | "syncRebase",
  ): Promise<void> {
    setIsSyncing(true);
    try {
      switch (key) {
        case "pull":
          await readBridge().gitPull({ projectLocation: project.location });
          break;
        case "pullRebase":
          await readBridge().gitPullRebase({ projectLocation: project.location });
          break;
        case "push":
          await readBridge().gitPush({
            projectLocation: project.location,
            setUpstream: !hasTracking,
          });
          applyStatusOptimistic((s) => ({ ...s, ahead: 0 }));
          setTimeout(() => onRefresh(), 1500);
          return;
        case "sync":
          await readBridge().gitSync({ projectLocation: project.location });
          break;
        case "syncRebase":
          await readBridge().gitSyncRebase({ projectLocation: project.location });
          break;
      }
      onRefresh();
    } catch (err) {
      console.error("[git] sync action failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsSyncing(false);
    }
  }

  async function performMerge(): Promise<boolean> {
    if (!sourceBranch || !worktreeBranch || !worktreePath) return false;
    setIsMerging(true);
    try {
      const result = await readBridge().gitMergeToSource({
        projectLocation: project.location,
        worktreeLocation: getWorktreeLocation(),
        worktreeBranch,
        sourceBranch,
      });
      if (!result.merged) {
        const detail = result.conflictFiles?.length
          ? `\nConflicts:\n${result.conflictFiles.join("\n")}`
          : "";
        toast.danger((result.error ?? msg("git.merge.failed")) + detail);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[git] merge failed", err);
      toast.danger(friendlyError(err));
      return false;
    } finally {
      setIsMerging(false);
    }
  }

  async function handleMergeOnly(): Promise<void> {
    if (await performMerge()) onRefresh();
  }

  async function handleMergeAndRemove(): Promise<void> {
    if (await performMerge()) onMergeAndRemove?.();
  }

  async function handlePullFromSource(): Promise<void> {
    if (!sourceBranch) return;
    setIsPullingFromSource(true);
    try {
      const result = await readBridge().gitPullFromSource({
        worktreeLocation: getWorktreeLocation(),
        sourceBranch,
      });
      if (result.conflicting) {
        onRefresh();
        return;
      }
      if (!result.merged) {
        toast.danger(result.error ?? msg("git.merge.failed"));
        return;
      }
      onRefresh();
    } catch (err) {
      console.error("[git] pull from source failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsPullingFromSource(false);
    }
  }

  async function handleAbortMerge(): Promise<void> {
    setIsAbortingMerge(true);
    try {
      await readBridge().gitAbortMerge({
        worktreeLocation: getWorktreeLocation(),
      });
      onRefresh();
    } catch (err) {
      console.error("[git] abort merge failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsAbortingMerge(false);
    }
  }

  async function handleFinishMerge(): Promise<void> {
    setIsFinishingMerge(true);
    try {
      const result = await readBridge().gitFinishMerge({
        worktreeLocation: getWorktreeLocation(),
      });
      if (!result.success) {
        toast.danger(result.error ?? msg("git.merge.finishFailed"));
        return;
      }
      onRefresh();
    } catch (err) {
      console.error("[git] finish merge failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsFinishingMerge(false);
    }
  }

  async function handleCreatePr(isDraft: boolean): Promise<void> {
    const targetBranch = prTargetBranch || sourceBranch;
    if (!effectiveBranch || !targetBranch) return;
    setIsCreatingPr(true);
    try {
      const pr = await readBridge().ghCreatePr({
        projectLocation: project.location,
        branch: effectiveBranch,
        baseBranch: targetBranch,
        title: prTitle.trim() || effectiveBranch,
        body: prBody.trim(),
        isDraft,
      });
      if (effectivePrKey) {
        useGitStore.getState().setPrData(effectivePrKey, pr);
      }
      setPrTitle("");
      setPrBody("");
    } catch (err) {
      console.error("[git] create PR failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsCreatingPr(false);
    }
  }

  async function handleGeneratePrSummary(): Promise<void> {
    const targetBranch = prTargetBranch || sourceBranch;
    if (!effectiveBranch || !targetBranch) return;

    const candidates = getCommitGenCandidates(projectAgentStatuses, commitGenProvider);
    if (candidates.length === 0) {
      toast.danger("No agent available to generate PR summary");
      return;
    }

    setIsGeneratingPr(true);
    for (const candidate of candidates) {
      const resolved = resolveCommitGenConfig(candidate, commitGenModel, commitGenEffort);
      try {
        const result = await readBridge().generatePrSummary({
          projectLocation: project.location,
          agentKind: candidate.kind,
          branch: effectiveBranch,
          baseBranch: targetBranch,
          ...(resolved.model ? { model: resolved.model } : {}),
          ...(resolved.effort ? { effort: resolved.effort } : {}),
        });
        setPrTitle(result.title);
        setPrBody(result.description);
        break;
      } catch (err) {
        if (commitGenProvider !== "auto") {
          console.error("[git] generate PR summary failed", err);
          toast.danger(friendlyError(err));
          break;
        }
      }
    }
    setIsGeneratingPr(false);
  }

  return {
    commitMessage,
    setCommitMessage,
    isCommitting,
    isGenerating,
    isSyncing,
    isMerging,
    isPullingFromSource,
    isAbortingMerge,
    isFinishingMerge,
    prTitle,
    setPrTitle,
    prBody,
    setPrBody,
    prTargetBranch,
    setPrTargetBranch,
    prLoading,
    isGeneratingPr,
    handleCommit,
    handleGenerateMessage,
    handleSyncOrPush,
    handleSyncAction,
    handleMergeOnly,
    handleMergeAndRemove,
    handlePullFromSource,
    handleAbortMerge,
    handleFinishMerge,
    handleCreatePr,
    handleMergePr: writeActions.handleMergePr,
    handleClosePr: writeActions.handleClosePr,
    handleMarkPrReady: writeActions.handleMarkPrReady,
    handleUpdatePrBranch: writeActions.handleUpdatePrBranch,
    handleGeneratePrSummary,
  };
}
