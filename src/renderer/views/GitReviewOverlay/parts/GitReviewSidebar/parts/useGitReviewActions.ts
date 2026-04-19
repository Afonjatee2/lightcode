// Reconstructed from the pre-split GitReviewSidebar.tsx (recovered monolithic
// version) + hints showing post-crash edits (getCurrentPrData pattern).
import { useState } from "react";
import { toast } from "@heroui/react";
import type {
  GitBranchInfo,
  GitStatusResult,
  PrData,
  Project,
  ProjectLocation,
} from "@/shared/contracts";
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
    onRefresh,
    onMergeAndRemove,
    effectiveBranch,
    effectivePrKey,
    sourceBranch,
  } = args;

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
  const [isRunningMergetool, setIsRunningMergetool] = useState(false);
  const [isAbortingMerge, setIsAbortingMerge] = useState(false);
  const [isFinishingMerge, setIsFinishingMerge] = useState(false);

  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prTargetBranch, setPrTargetBranch] = useState<string | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [isGeneratingPr, setIsGeneratingPr] = useState(false);

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

  function getCurrentPrData(): PrData | null | undefined {
    if (!effectivePrKey) return undefined;
    return useGitStore.getState().prData[effectivePrKey] as PrData | null | undefined;
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

  async function handleCommit(addAll: boolean): Promise<void> {
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
      await readBridge()
        .gitFetch({ projectLocation: project.location, remote: "origin", prune: false })
        .catch(() => undefined);
      onRefresh();
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
      } else {
        await readBridge().gitSync({ projectLocation: project.location });
      }
      onRefresh();
    } catch (err) {
      console.error("[git] sync/push failed", err);
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
    if (!sourceBranch || !worktreePath) return;
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

  async function handleRunMergetool(): Promise<void> {
    if (!worktreePath) return;
    setIsRunningMergetool(true);
    try {
      const result = await readBridge().gitRunMergetool({
        worktreeLocation: getWorktreeLocation(),
      });
      if (!result.success) {
        toast.danger(result.error ?? msg("git.mergetool.failed"));
        return;
      }
      onRefresh();
    } catch (err) {
      console.error("[git] mergetool failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setIsRunningMergetool(false);
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
    setPrLoading(true);
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
      setPrLoading(false);
    }
  }

  async function handleMergePr(method: "merge" | "squash" | "rebase"): Promise<void> {
    const prData = getCurrentPrData();
    if (!prData) return;
    setPrLoading(true);
    try {
      await readBridge().ghMergePr({
        projectLocation: project.location,
        prNumber: prData.number,
        method,
      });
      if (effectivePrKey) {
        useGitStore.getState().setPrData(effectivePrKey, { ...prData, state: "merged" });
      }
      onRefresh();
    } catch (err) {
      console.error("[git] merge PR failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setPrLoading(false);
    }
  }

  async function handleClosePr(): Promise<void> {
    const prData = getCurrentPrData();
    if (!prData) return;
    setPrLoading(true);
    try {
      await readBridge().ghClosePr({
        projectLocation: project.location,
        prNumber: prData.number,
      });
      if (effectivePrKey) {
        useGitStore.getState().setPrData(effectivePrKey, { ...prData, state: "closed" });
      }
    } catch (err) {
      console.error("[git] close PR failed", err);
      toast.danger(friendlyError(err));
    } finally {
      setPrLoading(false);
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
    isRunningMergetool,
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
    handleMergeOnly,
    handleMergeAndRemove,
    handlePullFromSource,
    handleRunMergetool,
    handleAbortMerge,
    handleFinishMerge,
    handleCreatePr,
    handleMergePr,
    handleClosePr,
    handleGeneratePrSummary,
  };
}
