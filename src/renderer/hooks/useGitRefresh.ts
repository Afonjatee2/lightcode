import { useEffect } from "react";
import type { PrData, Project, ProjectLocation } from "@/shared/contracts";
import { buildWorktreeLocation } from "@/shared/worktree";
import { parseDraftProjectId } from "@/shared/paneId";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import {
  GIT_FETCH_PRIORITY_INTERVAL_MS,
  GIT_FETCH_BACKGROUND_INTERVAL_MS,
} from "@/renderer/utils/gitHelpers";

export function useGitRefresh(projects: readonly Project[], storeHydrated: boolean) {
  useEffect(() => {
    if (!storeHydrated || projects.length === 0) return;

    const activeProjects = projects.filter((p) => !p.disabled);
    if (activeProjects.length === 0) return;

    let isActive = true;
    const refreshingProjects = new Set<string>();
    const pendingWatcherRefreshProjects = new Set<string>();
    const watchedWorktreePaths = new Map<string, string>();
    const lastFetchTimes = new Map<string, number>();
    let previousPriorityProjectIds = new Set<string>();
    type GitRefreshReason = "initial" | "watcher" | "fetch";

    async function refreshProject(
      project: { id: string; location: ProjectLocation },
      reason: GitRefreshReason,
    ) {
      if (!isActive) return;
      if (refreshingProjects.has(project.id)) {
        if (reason === "watcher") {
          pendingWatcherRefreshProjects.add(project.id);
        }
        console.log(`[git-refresh] skip project=${project.id} reason=${reason} inFlight=true`);
        return;
      }
      const startedAt = Date.now();
      console.log(`[git-refresh] start project=${project.id} reason=${reason}`);
      refreshingProjects.add(project.id);
      try {
        const [statusResult, branchesResult, worktreesResult] = await Promise.allSettled([
          readBridge().getGitStatus({ projectLocation: project.location }),
          readBridge().gitListBranches({
            projectLocation: project.location,
            includeRemote: true,
          }),
          readBridge().gitListWorktrees({ projectLocation: project.location }),
        ]);
        if (!isActive) return;

        const gitStoreActions = useGitStore.getState();

        const status = statusResult.status === "fulfilled" ? statusResult.value : undefined;
        const branches = branchesResult.status === "fulfilled" ? branchesResult.value : undefined;
        const worktrees =
          worktreesResult.status === "fulfilled" ? worktreesResult.value.worktrees : undefined;
        const ghAvailable = gitStoreActions.ghAvailable[project.id];

        gitStoreActions.setProjectSnapshot(project.id, {
          ...(status ? { status } : {}),
          ...(branches ? { branches } : {}),
          ...(worktrees ? { worktrees } : {}),
          ...(ghAvailable === undefined && status?.remoteInfo?.platform !== "github"
            ? { ghAvailable: false }
            : {}),
        });

        if (worktrees) {
          const worktreeStatusEntries = await Promise.all(
            worktrees
              .filter((wt) => !wt.isMain)
              .map(async (wt) => {
                if (!isActive) return undefined;
                try {
                  const wtLocation = buildWorktreeLocation(project.location, wt.path);
                  const wtStatus = await readBridge().getGitStatus({
                    projectLocation: wtLocation,
                  });
                  if (!isActive) return undefined;
                  return [wt.path, wtStatus] as const;
                } catch {
                  return undefined;
                }
              }),
          );
          if (!isActive) return;

          const nextWorktreeStatuses = Object.fromEntries(
            worktreeStatusEntries.filter((entry) => entry !== undefined),
          );
          if (Object.keys(nextWorktreeStatuses).length > 0) {
            useGitStore.getState().setWorktreeStatuses(nextWorktreeStatuses);
          }

          if (project.location.kind !== "wsl") {
            const wtPaths = worktrees
              .filter((wt) => !wt.isMain)
              .map((wt) => wt.path)
              .sort()
              .join("\0");
            if (wtPaths !== watchedWorktreePaths.get(project.id)) {
              watchedWorktreePaths.set(project.id, wtPaths);
              readBridge()
                .gitWatchWorktrees({
                  projectId: project.id,
                  worktreePaths: worktrees.filter((wt) => !wt.isMain).map((wt) => wt.path),
                })
                .catch(() => undefined);
            }
          }

          const sourceInfoEntries = await Promise.all(
            worktrees
              .filter((wt) => !wt.isMain && wt.branch)
              .map(async (wt) => {
                if (!isActive) return undefined;
                try {
                  const info = await readBridge().gitGetWorktreeSourceBranch({
                    projectLocation: project.location,
                    branch: wt.branch,
                  });
                  if (!isActive) return undefined;
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
          );
          if (!isActive) return;

          const nextSourceInfo = Object.fromEntries(
            sourceInfoEntries.filter((entry) => entry !== undefined),
          );
          if (Object.keys(nextSourceInfo).length > 0) {
            useGitStore.getState().setWorktreeSourceInfoBatch(nextSourceInfo);
          }
        }

        if (ghAvailable === undefined) {
          const isGitHub = status?.remoteInfo?.platform === "github";
          if (isGitHub) {
            readBridge()
              .ghCheckAvailable({ projectLocation: project.location })
              .then((r) => useGitStore.getState().setGhAvailable(project.id, r.available))
              .catch(() => useGitStore.getState().setGhAvailable(project.id, false));
          }
        }

        if (useGitStore.getState().ghAvailable[project.id]) {
          const currentThreads = useAppStore.getState().threads;
          const wtThreads = currentThreads.filter(
            (t) => t.projectId === project.id && t.worktreeBranch && t.worktreePath,
          );
          const prUpdates: Record<string, PrData | null> = {};
          const prNumberUpdates = new Map<string, number | undefined>();
          const projectBranch = status?.branch;
          const projectPrKey = `__branch:${project.id}`;

          await Promise.all([
            ...wtThreads.map(async (t) => {
              if (!isActive || !t.worktreeBranch || !t.worktreePath) return;
              try {
                const pr = await readBridge().ghGetPrForBranch({
                  projectLocation: project.location,
                  branch: t.worktreeBranch,
                });
                if (!isActive) return;
                prUpdates[t.worktreePath] = pr;
                const newPrNumber = pr?.number ?? undefined;
                if (newPrNumber !== t.prNumber) {
                  prNumberUpdates.set(t.id, newPrNumber);
                }
              } catch {
                // ignore — gh may not be authenticated
              }
            }),
            (async () => {
              if (!projectBranch) return;
              try {
                const pr = await readBridge().ghGetPrForBranch({
                  projectLocation: project.location,
                  branch: projectBranch,
                });
                if (!isActive) return;
                prUpdates[projectPrKey] = pr;
              } catch {
                // ignore — gh may not be authenticated
              }
            })(),
          ]);
          if (!isActive) return;

          if (Object.keys(prUpdates).length > 0) {
            useGitStore.getState().setPrDataBatch(prUpdates);
          }
          if (prNumberUpdates.size > 0) {
            useAppStore.setState((state) => {
              let changed = false;
              const nextThreads = state.threads.map((thread) => {
                if (!prNumberUpdates.has(thread.id)) {
                  return thread;
                }
                const nextPrNumber = prNumberUpdates.get(thread.id);
                if (thread.prNumber === nextPrNumber) {
                  return thread;
                }
                changed = true;
                return { ...thread, prNumber: nextPrNumber };
              });
              return changed ? { threads: nextThreads } : state;
            });
          }
        }
      } finally {
        console.log(
          `[git-refresh] done project=${project.id} reason=${reason} durationMs=${Date.now() - startedAt}`,
        );
        refreshingProjects.delete(project.id);
        if (pendingWatcherRefreshProjects.delete(project.id)) {
          console.log(`[git-refresh] rerun project=${project.id} reason=watcher`);
          void refreshProject(project, "watcher");
        }
      }
    }

    function scheduleWatcherRefresh(project: { id: string; location: ProjectLocation }) {
      if (!isActive) return;
      void refreshProject(project, "watcher");
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

    void fetchRemotes();
    const fetchIntervalId = setInterval(
      () => void fetchRemotes(),
      Math.min(GIT_FETCH_PRIORITY_INTERVAL_MS, GIT_FETCH_BACKGROUND_INTERVAL_MS),
    );

    return () => {
      isActive = false;
      clearInterval(fetchIntervalId);
      unsubWatcher();
      for (const project of activeProjects) {
        readBridge()
          .gitUnwatchProject({ projectId: project.id })
          .catch(() => undefined);
      }
    };
  }, [storeHydrated, projects]);
}
