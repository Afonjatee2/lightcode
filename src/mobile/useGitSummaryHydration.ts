import { useEffect } from "react";
import { readBridge } from "@/renderer/bridge";
import { resolvePrKey } from "@/renderer/state/gitSelectors";
import { useGitStore } from "@/renderer/state/gitStore";
import type { GitStatusResult, PrData, Project, ProjectLocation, Thread } from "@/shared/contracts";
import type { RemoteThreadGitSummary } from "@/shared/remote";
import { buildWorktreeLocation } from "@/shared/worktree";
import { useGitSummariesStore } from "./gitSummaries";

const pendingPrFetches = new Map<string, Promise<PrData | null>>();
const GIT_STATUS_BRIDGE_RETRY_DELAY_MS = 250;
const GIT_STATUS_BRIDGE_RETRY_LIMIT = 40;

function prSummaryFromData(pr: PrData | null): RemoteThreadGitSummary["pr"] {
  if (!pr) return null;
  return {
    number: pr.number,
    state: pr.state,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    ...(pr.checksStatus ? { checksStatus: pr.checksStatus } : {}),
  };
}

function fetchPrForBranch(projectLocation: ProjectLocation, branch: string) {
  const key = `${JSON.stringify(projectLocation)}\0${branch}`;
  const existing = pendingPrFetches.get(key);
  if (existing) return existing;

  const pending = readBridge()
    .ghGetPrForBranch({ projectLocation, branch })
    .finally(() => {
      if (pendingPrFetches.get(key) === pending) pendingPrFetches.delete(key);
    });
  pendingPrFetches.set(key, pending);
  return pending;
}

/**
 * Fetch the authoritative PR for a mobile thread from its paired host and
 * hydrate both caches used by the PWA: the reused desktop Git panel reads
 * gitStore, while thread/workspace badges read gitSummariesStore.
 */
export async function refreshMobilePrData(input: {
  readonly projectLocation: ProjectLocation;
  readonly branch: string;
  readonly prKey: string;
  readonly threadId?: string | undefined;
}): Promise<PrData | null | undefined> {
  try {
    const pr = await fetchPrForBranch(input.projectLocation, input.branch);
    useGitStore.getState().setPrData(input.prKey, pr);
    if (input.threadId) {
      useGitSummariesStore.getState().setThreadPr(input.threadId, prSummaryFromData(pr));
    }
    return pr;
  } catch {
    return undefined;
  }
}

function summaryFromStatus(thread: Thread, status: GitStatusResult): RemoteThreadGitSummary {
  const pr =
    useGitStore.getState().prData[resolvePrKey(thread.projectId, thread.worktreePath)] ?? null;
  return {
    isRepo: status.isRepo,
    branch: status.branch,
    totalInsertions: status.totalInsertions,
    totalDeletions: status.totalDeletions,
    ahead: status.ahead,
    behind: status.behind,
    pr:
      pr === null
        ? null
        : {
            number: pr.number,
            state: pr.state,
            title: pr.title,
            url: pr.url,
            isDraft: pr.isDraft,
            ...(pr.checksStatus ? { checksStatus: pr.checksStatus } : {}),
          },
  };
}

export function updateMobileGitSummary(
  thread: Thread,
  project: Project,
  status: GitStatusResult,
): void {
  const gitStore = useGitStore.getState();
  if (thread.worktreePath) gitStore.setWorktreeStatus(thread.worktreePath, status);
  else gitStore.setStatus(project.id, status);
  useGitSummariesStore.getState().setThread(thread.id, summaryFromStatus(thread, status));
}

export function useGitSummaryHydration(
  thread: Thread | null | undefined,
  project: Project | null | undefined,
): void {
  const cached = useGitSummariesStore((s) => (thread ? s.byThread[thread.id] : undefined));
  const cachedBranch = cached?.isRepo ? cached.branch : undefined;
  const hasKnownPr = Boolean(cached?.pr || thread?.prNumber);

  useEffect(() => {
    if (!thread || !project || cached) return;
    const currentThread = thread;
    const currentProject = project;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const projectLocation = currentThread.worktreePath
      ? buildWorktreeLocation(currentProject.location, currentThread.worktreePath)
      : currentProject.location;

    function retry() {
      if (cancelled || attempts >= GIT_STATUS_BRIDGE_RETRY_LIMIT) return;
      attempts += 1;
      retryTimer = setTimeout(attempt, GIT_STATUS_BRIDGE_RETRY_DELAY_MS);
    }

    function attempt() {
      if (cancelled || useGitSummariesStore.getState().byThread[currentThread.id]) return;

      let bridge: ReturnType<typeof readBridge>;
      try {
        bridge = readBridge();
      } catch {
        retry();
        return;
      }
      if (typeof bridge.getGitStatus !== "function") return;

      void Promise.resolve()
        .then(() => bridge.getGitStatus({ projectLocation }))
        .then((status) => {
          if (cancelled) return;
          updateMobileGitSummary(currentThread, currentProject, status);
        })
        .catch(() => retry());
    }

    attempt();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [thread, project, cached]);

  // The compact desktop summary powers the thread header, but the reused Git
  // panel reads full PR data from gitStore. Refresh known PRs on the phone so a
  // worktree panel does not fall back to "Create PR" or retain stale checks.
  useEffect(() => {
    if (!thread || !project || !cachedBranch || !hasKnownPr) return;
    useGitStore.getState().setGhAvailable(project.id, true);
    void refreshMobilePrData({
      projectLocation: project.location,
      branch: cachedBranch,
      prKey: resolvePrKey(thread.projectId, thread.worktreePath),
      threadId: thread.id,
    });
  }, [cachedBranch, hasKnownPr, project, thread]);
}
