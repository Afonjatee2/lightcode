import { useEffect, useRef } from "react";
import type { PrData, Project, ProjectLocation } from "@/shared/contracts";
import { parseDraftProjectId } from "@/shared/paneId";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { buildBranchPrKey } from "@/renderer/state/gitSelectors";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import {
  GIT_FETCH_PRIORITY_INTERVAL_MS,
  GIT_FETCH_BACKGROUND_INTERVAL_MS,
} from "@/renderer/utils/gitHelpers";

export function useGitRefresh(projects: readonly Project[], storeHydrated: boolean) {
  // Keep the latest projects in a ref so the effect can read them without
  // re-running every time the appStore mints a new array reference (which
  // happens on agent-status events, view changes, etc.). The effect only
  // re-runs when the *set* of active project IDs changes.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const activeProjectsKey = projects
    .filter((p) => !p.disabled)
    .map((p) => `${p.id}:${p.location.kind}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!storeHydrated || projectsRef.current.length === 0) return;

    const activeProjects = projectsRef.current.filter((p) => !p.disabled);
    if (activeProjects.length === 0) return;

    let isActive = true;
    const refreshingProjects = new Set<string>();
    const pendingWatcherRefreshProjects = new Set<string>();
    const watchedWorktreePaths = new Map<string, string>();
    const lastFetchTimes = new Map<string, number>();
    let previousPriorityProjectIds = new Set<string>();
    type GitRefreshReason = "initial" | "watcher" | "fetch";
    type GitRefreshMode = "status" | "full";

    // Status-only refresh: just `git status` for the project + each cached
    // worktree. No branches/worktree-list/source-branch/PR fetches. Used by
    // the fs watcher so a single `.git` write only costs one wsl.exe spawn
    // (vs ~6+ for the full path), keeping the push button reactive on WSL.
    async function refreshProjectStatusOnly(project: {
      id: string;
      location: ProjectLocation;
    }): Promise<void> {
      const statusResult = await readBridge()
        .getGitStatus({ projectLocation: project.location })
        .catch(() => undefined);
      if (!isActive) return;
      if (statusResult) {
        useGitStore.getState().setStatus(project.id, statusResult);
      }

      const cachedWorktrees = useGitStore.getState().worktrees[project.id];
      if (!cachedWorktrees || cachedWorktrees.length === 0) return;
      const childWorktreePaths = cachedWorktrees.filter((wt) => !wt.isMain).map((wt) => wt.path);
      if (childWorktreePaths.length === 0) return;
      const batch = await readBridge()
        .gitWorktreeStatusBatch({
          projectLocation: project.location,
          worktreePaths: childWorktreePaths,
        })
        .catch(() => undefined);
      if (!isActive || !batch) return;
      if (Object.keys(batch.statuses).length > 0) {
        useGitStore.getState().setWorktreeStatuses(batch.statuses);
      }
    }

    async function refreshProject(
      project: { id: string; location: ProjectLocation },
      reason: GitRefreshReason,
      mode: GitRefreshMode = "full",
    ) {
      if (!isActive) return;
      if (refreshingProjects.has(project.id)) {
        if (reason === "watcher") {
          pendingWatcherRefreshProjects.add(project.id);
        }
        console.log(
          `[git-refresh] skip project=${project.id} reason=${reason} mode=${mode} inFlight=true`,
        );
        return;
      }
      const startedAt = Date.now();
      console.log(`[git-refresh] start project=${project.id} reason=${reason} mode=${mode}`);
      refreshingProjects.add(project.id);
      try {
        if (mode === "status") {
          await refreshProjectStatusOnly(project);
          return;
        }

        // One IPC round-trip pulls status + branches + worktrees (+ gh check
        // when not cached) via supervisor-side Promise.all. Cuts three IPC
        // handshakes to one and lets the supervisor parallelize freely. Each
        // field writes to the store as soon as the bundle lands.
        const cachedGhAvailable = useGitStore.getState().ghAvailable[project.id] === true;
        const snapshotPromise = readBridge()
          .gitProjectSnapshot({
            projectLocation: project.location,
            includeGhCheck: !cachedGhAvailable,
          })
          .then((snap) => {
            const store = useGitStore.getState();
            if (snap.status) store.setStatus(project.id, snap.status);
            if (snap.branches) store.setBranches(project.id, snap.branches);
            if (snap.worktrees) store.setWorktrees(project.id, snap.worktrees);
            if (snap.ghAvailable === true) store.setGhAvailable(project.id, true);
            return snap;
          })
          .catch((err) => {
            console.warn(`[git-refresh] gitProjectSnapshot failed project=${project.id}`, err);
            return null;
          });

        const statusPromise = snapshotPromise.then((snap) => snap?.status ?? undefined);
        const worktreesPromise = snapshotPromise.then((snap) => snap?.worktrees ?? undefined);

        const ghAvailablePromise: Promise<boolean> = cachedGhAvailable
          ? Promise.resolve(true)
          : snapshotPromise.then((snap) => {
              const platform = snap?.status?.remoteInfo?.platform;
              const mightBeGitHub = platform === "github" || platform === "unknown";
              if (!mightBeGitHub) return false;
              return snap?.ghAvailable === true;
            });

        // Worktree-derived work (per-worktree status + source branch) starts as
        // soon as `gitListWorktrees` returns — doesn't wait for status/branches.
        const worktreeWorkPromise = worktreesPromise.then(async (worktrees) => {
          if (!worktrees) return;
          const childWorktrees = worktrees.filter((wt) => !wt.isMain);

          if (project.location.kind !== "wsl") {
            const wtPaths = childWorktrees
              .map((wt) => wt.path)
              .sort()
              .join("\0");
            if (wtPaths !== watchedWorktreePaths.get(project.id)) {
              watchedWorktreePaths.set(project.id, wtPaths);
              readBridge()
                .gitWatchWorktrees({
                  projectId: project.id,
                  worktreePaths: childWorktrees.map((wt) => wt.path),
                })
                .catch(() => undefined);
            }
          }

          const statusesPromise = readBridge()
            .gitWorktreeStatusBatch({
              projectLocation: project.location,
              worktreePaths: childWorktrees.map((wt) => wt.path),
            })
            .then((batch) => {
              if (Object.keys(batch.statuses).length > 0) {
                useGitStore.getState().setWorktreeStatuses(batch.statuses);
              }
            })
            .catch(() => undefined);

          const sourceInfoPromise = Promise.all(
            childWorktrees
              .filter((wt) => wt.branch)
              .map(async (wt) => {
                try {
                  const info = await readBridge().gitGetWorktreeSourceBranch({
                    projectLocation: project.location,
                    branch: wt.branch,
                  });
                  return [
                    wt.path,
                    {
                      sourceBranch: info.sourceBranch,
                      commitsAhead: info.commitsAhead,
                      sourceAhead: info.sourceAhead,
                    },
                  ] as const;
                } catch {
                  return undefined;
                }
              }),
          ).then((entries) => {
            const next = Object.fromEntries(entries.filter((e) => e !== undefined));
            if (Object.keys(next).length > 0) {
              useGitStore.getState().setWorktreeSourceInfoBatch(next);
            }
          });

          await Promise.all([statusesPromise, sourceInfoPromise]);
        });

        // PR fetches: each one starts the moment its prerequisites resolve.
        // Worktree-thread PRs only need `ghAvailable`; project PR also needs
        // `status.branch`. They run concurrently with everything above.
        const prUpdates: Record<string, PrData | null> = {};
        const prNumberUpdates = new Map<string, number | undefined>();
        const currentThreads = useAppStore.getState().threads;
        const wtThreads = currentThreads.filter(
          (t) => t.projectId === project.id && t.worktreeBranch && t.worktreePath,
        );

        const wtPrPromises = wtThreads.map(async (t) => {
          const ghAvailable = await ghAvailablePromise;
          if (!ghAvailable || !t.worktreeBranch || !t.worktreePath) return;
          try {
            const pr = await readBridge().ghGetPrForBranch({
              projectLocation: project.location,
              branch: t.worktreeBranch,
            });
            prUpdates[t.worktreePath] = pr;
            const newPrNumber = pr?.number ?? undefined;
            if (newPrNumber !== t.prNumber) {
              prNumberUpdates.set(t.id, newPrNumber);
            }
          } catch (err) {
            console.warn(
              `[git-refresh] ghGetPrForBranch failed (worktree) project=${project.id} branch=${t.worktreeBranch}`,
              err,
            );
          }
        });

        const projectPrPromise = (async () => {
          const [status, ghAvailable] = await Promise.all([statusPromise, ghAvailablePromise]);
          if (!ghAvailable || !status?.branch) return;
          const platform = status.remoteInfo?.platform;
          if (platform !== "github" && platform !== "unknown") return;
          try {
            const pr = await readBridge().ghGetPrForBranch({
              projectLocation: project.location,
              branch: status.branch,
            });
            prUpdates[buildBranchPrKey(project.id)] = pr;
          } catch (err) {
            console.warn(
              `[git-refresh] ghGetPrForBranch failed (project) project=${project.id} branch=${status.branch}`,
              err,
            );
          }
        })();

        await Promise.all([
          snapshotPromise,
          worktreeWorkPromise,
          ...wtPrPromises,
          projectPrPromise,
        ]);

        if (Object.keys(prUpdates).length > 0) {
          useGitStore.getState().setPrDataBatch(prUpdates);
        }
        if (prNumberUpdates.size > 0) {
          useAppStore.setState((state) => {
            let changed = false;
            const nextThreads = state.threads.map((thread) => {
              if (!prNumberUpdates.has(thread.id)) return thread;
              const nextPrNumber = prNumberUpdates.get(thread.id);
              if (thread.prNumber === nextPrNumber) return thread;
              changed = true;
              return { ...thread, prNumber: nextPrNumber };
            });
            return changed ? { threads: nextThreads } : state;
          });
        }
      } finally {
        console.log(
          `[git-refresh] done project=${project.id} reason=${reason} mode=${mode} durationMs=${Date.now() - startedAt}`,
        );
        refreshingProjects.delete(project.id);
        if (pendingWatcherRefreshProjects.delete(project.id)) {
          console.log(`[git-refresh] rerun project=${project.id} reason=watcher mode=status`);
          void refreshProject(project, "watcher", "status");
        }
      }
    }

    function scheduleWatcherRefresh(project: { id: string; location: ProjectLocation }) {
      if (!isActive) return;
      void refreshProject(project, "watcher", "status");
    }

    function getPriorityProjectIds(): Set<string> {
      const state = useAppStore.getState();
      const priorityProjectIds = new Set<string>();

      if (state.view.kind === "draft" && state.view.projectId) {
        priorityProjectIds.add(state.view.projectId);
        return priorityProjectIds;
      }

      if (state.view.kind !== "thread") {
        return priorityProjectIds;
      }

      for (const paneId of state.view.panes) {
        const draftProjectId = parseDraftProjectId(paneId);
        if (draftProjectId) {
          priorityProjectIds.add(draftProjectId);
          continue;
        }
        const threadProjectId = state.threads.find((thread) => thread.id === paneId)?.projectId;
        if (threadProjectId) {
          priorityProjectIds.add(threadProjectId);
        }
      }

      return priorityProjectIds;
    }

    for (const project of activeProjects) {
      readBridge()
        .gitWatchProject({ projectId: project.id, projectLocation: project.location })
        .catch(() => undefined);
    }

    const unsubWatcher = readBridge().onSupervisorEvent((event) => {
      // Both events are git-affecting: `.git` metadata clearly, and worktree
      // edits change `git status` output (a tracked file becomes modified,
      // an untracked file appears, etc.). Refresh git state for either.
      if (event.type === "git-changed" || event.type === "project-tree-changed") {
        console.log(`[git-refresh] watcher-event ${event.type} project=${event.projectId}`);
        const project = activeProjects.find((p) => p.id === event.projectId);
        if (project) scheduleWatcherRefresh(project);
      }
      if (event.type === "project-tree-changed") {
        const editorRoot = useFileEditorStore.getState().rootContext;
        if (editorRoot && editorRoot.projectId === event.projectId) {
          useFileEditorStore.getState().bumpRefreshToken();
          void useFileEditorStore.getState().refreshOpenBuffers();
        }
      }
    });

    for (const project of activeProjects) {
      void refreshProject(project, "initial");
    }

    async function fetchRemotes() {
      if (!isActive) return;
      if (typeof document !== "undefined" && !document.hasFocus()) {
        console.log("[git-refresh] fetch-skip windowFocused=false");
        return;
      }
      const now = Date.now();
      const priorityProjectIds = getPriorityProjectIds();
      const promotedProjectIds = new Set(
        [...priorityProjectIds].filter((projectId) => !previousPriorityProjectIds.has(projectId)),
      );
      const projectsToFetch = activeProjects.filter((project) => {
        const isPriority = priorityProjectIds.has(project.id);
        const interval = isPriority
          ? GIT_FETCH_PRIORITY_INTERVAL_MS
          : GIT_FETCH_BACKGROUND_INTERVAL_MS;
        const lastFetchedAt = lastFetchTimes.get(project.id) ?? 0;
        const becamePriority = promotedProjectIds.has(project.id);
        return becamePriority || now - lastFetchedAt >= interval;
      });
      previousPriorityProjectIds = priorityProjectIds;
      if (projectsToFetch.length === 0) return;

      await Promise.all(
        projectsToFetch.map(async (project) => {
          if (!isActive) return;
          const isPriority = priorityProjectIds.has(project.id);
          const promoted = promotedProjectIds.has(project.id);
          console.log(
            `[git-refresh] fetch-start project=${project.id} priority=${isPriority} promoted=${promoted}`,
          );
          lastFetchTimes.set(project.id, now);
          try {
            await readBridge().gitFetch({
              projectLocation: project.location,
              remote: "origin",
              prune: false,
            });
          } catch {
            // ignore — remote may be unreachable
          }
          if (isActive) void refreshProject(project, "fetch");
        }),
      );
    }

    // Defer the first remote fetch until after the initial refresh batch has
    // had a chance to paint UI. Running them concurrently means git fetch's
    // ref updates (legitimate `.git/refs/...` writes) trigger watcher events
    // mid-init, which queue a redundant refresh-after-init. Letting init
    // finish first cleanly separates "local snapshot" from "remote sync".
    const initialFetchTimer = setTimeout(() => void fetchRemotes(), 5000);
    const fetchIntervalId = setInterval(
      () => void fetchRemotes(),
      Math.min(GIT_FETCH_PRIORITY_INTERVAL_MS, GIT_FETCH_BACKGROUND_INTERVAL_MS),
    );

    return () => {
      isActive = false;
      clearTimeout(initialFetchTimer);
      clearInterval(fetchIntervalId);
      unsubWatcher();
      for (const project of activeProjects) {
        readBridge()
          .gitUnwatchProject({ projectId: project.id })
          .catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectsRef is intentionally read via .current
  }, [storeHydrated, activeProjectsKey]);
}
