import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDbStorage } from "./dbStorage";
import type {
  AgentStatus,
  AppView,
  Project,
  ProjectDraftConfig,
  ProjectLocation,
  ProjectScripts,
  PromptSegment,
  SessionRef,
  Thread,
  ThreadAttention,
  ThreadConfig,
  ThreadServerRequestId,
  ThreadRuntimeSnapshot,
  ThreadStatus,
} from "@/shared/contracts";
import type { Attachment } from "../components/composer/useAttachments";
import { isDraftPaneId, makeDraftPaneId, parseDraftProjectId } from "@/shared/paneId";
import type { PaneLayout, PaneLayoutInsertTarget } from "@/shared/paneLayout";
import {
  adjustInsertTargetForRemoval,
  buildPaneLayoutFromLegacy,
  collectPaneIds,
  insertPaneInLayout,
  removePaneFromLayout,
  replacePaneIdInLayout,
  splitPaneInLayout,
  swapPaneIdsInLayout,
} from "@/shared/paneLayout";
import {
  paneIndexToRowCol,
  addToRowLayout,
  insertRowInLayout,
  removeIndicesFromRowLayout,
} from "@/shared/rowLayout";
import { getProjectName } from "@/shared/wsl";
import {
  reorderIds,
  reorderThreadBlockInProject,
  reorderThreadsInProject,
  type ReorderPlacement,
} from "./reorder";

export function makeThreadTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

function normalizeStoredThreadStatus(thread: Thread): Thread {
  if (thread.status === "inactive") {
    return thread;
  }

  return {
    ...thread,
    status: "inactive",
    attention: "none",
  };
}

/**
 * Transition any "finished" threads that are now visible in panes back to "idle".
 * Returns updated array if any thread changed, or null if nothing changed.
 */
function clearFinishedAndDone(threads: Thread[], panes: string[]): Thread[] | null {
  let changed = false;
  const result = threads.map((t) => {
    if (!panes.includes(t.id)) return t;
    if (t.status === "finished" || t.done) {
      changed = true;
      return {
        ...t,
        ...(t.status === "finished" ? { status: "idle" as ThreadStatus } : {}),
        ...(t.done ? { done: false } : {}),
      };
    }
    return t;
  });
  return changed ? result : null;
}

/** Compute the next rowLayout after removing panes at the given flat indices. */
function rowLayoutAfterRemove(
  view: { rowLayout?: number[]; panes: string[] },
  removedIndices: Set<number>,
): number[] | undefined {
  if (!view.rowLayout) return undefined;
  const result = removeIndicesFromRowLayout(view.rowLayout, removedIndices);
  return result.length > 0 ? result : undefined;
}

function rowLayoutAfterInsert(
  rowLayout: number[] | undefined,
  paneCountBeforeInsert: number,
  insertIndex: number,
  edge?: "left" | "right" | "top" | "bottom",
): number[] | undefined {
  if (!edge) {
    return rowLayout;
  }

  const clampedIndex = Math.max(0, Math.min(paneCountBeforeInsert, insertIndex));
  const baseLayout = rowLayout ?? (paneCountBeforeInsert > 1 ? [paneCountBeforeInsert] : undefined);

  if (baseLayout) {
    if (edge === "top" || edge === "bottom") {
      const targetIndex = Math.min(clampedIndex, paneCountBeforeInsert - 1);
      const { row } = paneIndexToRowCol(baseLayout, targetIndex);
      return insertRowInLayout(baseLayout, edge === "top" ? row : row + 1);
    }

    const targetPaneIndex = edge === "right" ? Math.max(0, clampedIndex - 1) : clampedIndex;
    return addToRowLayout(baseLayout, Math.min(targetPaneIndex, paneCountBeforeInsert - 1));
  }

  if (edge === "top" || edge === "bottom") {
    return [1, 1];
  }

  return undefined;
}

/** Build the view update for pane removals, preserving rowLayout. */
function viewAfterPaneRemoval(
  view: { kind: "thread"; panes: [string, ...string[]]; rowLayout?: number[] },
  remaining: string[],
  removedIndices: Set<number>,
): AppView {
  if (remaining.length === 0) return { kind: "home" as const };
  const rl = rowLayoutAfterRemove(view, removedIndices);
  return {
    ...view,
    panes: remaining as [string, ...string[]],
    ...(rl ? { rowLayout: rl } : {}),
  };
}

function currentPaneLayout(view: Extract<AppView, { kind: "thread" }>) {
  return view.paneLayout ?? buildPaneLayoutFromLegacy(view.panes, view.rowLayout);
}

function saveGroupLayout(state: {
  view: AppView;
  groupLayouts: Record<string, SavedGroupLayout>;
}): Record<string, SavedGroupLayout> {
  if (state.view.kind !== "thread" || !state.view.activeGroupId) return state.groupLayouts;
  return {
    ...state.groupLayouts,
    [state.view.activeGroupId]: {
      panes: [...state.view.panes],
      ...(state.view.paneLayout ? { paneLayout: state.view.paneLayout } : {}),
    },
  };
}

function viewFromPaneLayout(
  layout: ReturnType<typeof removePaneFromLayout>,
  activeGroupId?: string,
): AppView {
  if (!layout) return { kind: "home" };
  return {
    kind: "thread",
    panes: collectPaneIds(layout),
    paneLayout: layout,
    ...(activeGroupId ? { activeGroupId } : {}),
  };
}

function replacePaneInView(
  view: Extract<AppView, { kind: "thread" }>,
  oldPaneId: string,
  newPaneId: string,
): Extract<AppView, { kind: "thread" }> {
  if (!view.paneLayout) {
    const panes = [...view.panes] as [string, ...string[]];
    const idx = panes.indexOf(oldPaneId);
    if (idx !== -1) panes[idx] = newPaneId;
    return { ...view, panes };
  }

  const layout = replacePaneIdInLayout(currentPaneLayout(view), oldPaneId, newPaneId);
  return {
    kind: "thread",
    panes: collectPaneIds(layout),
    paneLayout: layout,
    ...(view.activeGroupId ? { activeGroupId: view.activeGroupId } : {}),
  };
}

function removePaneFromView(view: Extract<AppView, { kind: "thread" }>, paneId: string): AppView {
  if (view.paneLayout) {
    return viewFromPaneLayout(removePaneFromLayout(view.paneLayout, paneId), view.activeGroupId);
  }

  const idx = view.panes.indexOf(paneId);
  const remaining = view.panes.filter((id) => id !== paneId);
  if (remaining.length === 0) return { kind: "home" };
  return viewAfterPaneRemoval(view, remaining, new Set(idx !== -1 ? [idx] : []));
}

export interface PendingThreadServerRequest {
  threadId: string;
  requestId: ThreadServerRequestId;
  method: string;
  params: unknown;
  receivedAt: string;
}

export interface DraftContent {
  segments: PromptSegment[];
  attachments: Attachment[];
}

export interface SavedGroupLayout {
  panes: string[];
  paneLayout?: PaneLayout;
}

interface AppStoreState {
  projects: Project[];
  threads: Thread[];
  pendingServerRequests: PendingThreadServerRequest[];
  pendingThreadLaunches: Record<string, string>;
  pendingLaunchSegments: Record<string, PromptSegment[]>;
  draftContents: Record<string, DraftContent>;
  groupLayouts: Record<string, SavedGroupLayout>;
  agentStatuses: AgentStatus[];
  wslAgentStatuses: AgentStatus[];
  view: AppView;
  focusedPaneId: string | null;
  setFocusedPane: (paneId: string) => void;
  setAgentStatuses: (statuses: AgentStatus[]) => void;
  setWslAgentStatuses: (statuses: AgentStatus[]) => void;
  markThreadsInactiveOnLaunch: () => void;
  addProject: (location: ProjectLocation, nameOverride?: string) => Project;
  deleteProject: (projectId: string) => void;
  updateProjectDraftConfig: (projectId: string, draftConfig: ProjectDraftConfig) => void;
  updateProjectScripts: (projectId: string, scripts: ProjectScripts) => void;
  renameProject: (projectId: string, name: string) => void;
  openDraft: (projectId: string) => void;
  openDraftSideBySide: (projectId: string) => void;
  openHome: () => void;
  openThread: (threadId: string) => void;
  openThreadSideBySide: (threadId: string) => void;
  openGroupView: (groupId: string) => void;
  closeGroupView: () => void;
  replaceSecondPane: (threadId: string) => void;
  replacePaneAtIndex: (threadId: string, index: number) => void;
  insertPaneAtIndex: (
    threadId: string,
    index: number,
    edge?: "left" | "right" | "top" | "bottom",
  ) => void;
  movePaneToIndex: (
    paneId: string,
    targetIndex: number,
    edge?: "left" | "right" | "top" | "bottom",
  ) => void;
  replacePaneById: (threadId: string, targetPaneId: string) => void;
  splitPaneById: (
    threadId: string,
    targetPaneId: string,
    edge: "left" | "right" | "top" | "bottom",
  ) => void;
  insertPaneAtLayoutTarget: (threadId: string, target: PaneLayoutInsertTarget) => void;
  movePaneToLayoutTarget: (
    paneId: string,
    target: PaneLayoutInsertTarget | { paneId: string; edge: "left" | "right" | "top" | "bottom" },
  ) => void;
  swapPanes: (firstPaneId: string, secondPaneId: string) => void;
  closePane: (threadId: string) => void;
  replacePaneId: (oldId: string, newId: string) => void;
  createThread: (input: {
    projectId: string;
    agentKind: Thread["agentKind"];
    config: ThreadConfig;
    prompt: string;
    worktreePath?: string;
    worktreeBranch?: string;
    groupId?: string;
    groupName?: string;
    replacePaneId?: string;
  }) => Thread;
  queueThreadLaunch: (threadId: string, prompt: string, segments?: PromptSegment[]) => void;
  consumeThreadLaunch: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => void;
  updateThreadConfig: (threadId: string, config: ThreadConfig) => void;
  updateThreadRuntime: (
    threadId: string,
    input: {
      status: ThreadStatus;
      attention: ThreadAttention;
      config?: ThreadConfig;
      sessionRef?: SessionRef;
      canResumeWithConfig: boolean;
    },
  ) => void;
  addThreadServerRequest: (input: {
    threadId: string;
    requestId: ThreadServerRequestId;
    method: string;
    params: unknown;
  }) => void;
  removeThreadServerRequest: (threadId: string, requestId: ThreadServerRequestId) => void;
  clearThreadServerRequests: (threadId: string) => void;
  archiveThread: (threadId: string) => void;
  unarchiveThread: (threadId: string) => void;
  markThreadDone: (threadId: string) => void;
  unmarkThreadDone: (threadId: string) => void;
  purgeStaleArchivedThreads: (maxAgeDays: number) => void;
  markThreadExited: (threadId: string) => void;
  touchThread: (threadId: string) => void;
  reconcileRuntimeSnapshots: (snapshots: ThreadRuntimeSnapshot[]) => void;
  reorderProjects: (sourceId: string, targetId: string, placement: ReorderPlacement) => void;
  reorderThreads: (sourceId: string, targetId: string, placement: ReorderPlacement) => void;
  reorderThreadBlock: (blockIds: string[], targetId: string, placement: ReorderPlacement) => void;
  reorderPanes: (sourceId: string, targetId: string, placement: ReorderPlacement) => void;
  saveDraftContent: (projectId: string, content: DraftContent) => void;
  clearDraftContent: (projectId: string) => void;
}

export const useAppStore = create<AppStoreState>()(
  persist(
    (set) => ({
      projects: [],
      threads: [],
      pendingServerRequests: [],
      pendingThreadLaunches: {},
      pendingLaunchSegments: {},
      draftContents: {},
      groupLayouts: {},
      agentStatuses: [],
      wslAgentStatuses: [],
      view: { kind: "home" },
      focusedPaneId: null,
      setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
      setAgentStatuses: (incoming) =>
        set((prev) => {
          if (
            prev.agentStatuses.length === incoming.length &&
            prev.agentStatuses.every(
              (a, i) =>
                a.kind === incoming[i]!.kind &&
                a.installed === incoming[i]!.installed &&
                a.version === incoming[i]!.version &&
                a.authState === incoming[i]!.authState,
            )
          ) {
            return prev;
          }
          return { agentStatuses: incoming };
        }),
      setWslAgentStatuses: (incoming) =>
        set((prev) => {
          if (
            prev.wslAgentStatuses.length === incoming.length &&
            prev.wslAgentStatuses.every(
              (a, i) =>
                a.kind === incoming[i]!.kind &&
                a.installed === incoming[i]!.installed &&
                a.version === incoming[i]!.version &&
                a.authState === incoming[i]!.authState,
            )
          ) {
            return prev;
          }
          return { wslAgentStatuses: incoming };
        }),
      markThreadsInactiveOnLaunch: () =>
        set((state) => {
          let changed = false;

          const threads = state.threads.map((thread) => {
            if (thread.status === "inactive" || thread.status === "error") {
              return thread;
            }

            changed = true;
            return {
              ...thread,
              status: "inactive" as ThreadStatus,
              attention: "none" as ThreadAttention,
            };
          });

          return changed ? { threads } : {};
        }),
      addProject: (location, nameOverride) => {
        const project: Project = {
          id: crypto.randomUUID(),
          name: nameOverride?.trim() || getProjectName(location),
          location,
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          projects: [project, ...state.projects],
        }));

        return project;
      },
      deleteProject: (projectId) =>
        set((state) => {
          const nextProjects = state.projects.filter((project) => project.id !== projectId);

          if (nextProjects.length === state.projects.length) {
            return {};
          }

          const projectThreadIds = new Set(
            state.threads
              .filter((thread) => thread.projectId === projectId)
              .map((thread) => thread.id),
          );

          const nextThreads = state.threads.filter((thread) => thread.projectId !== projectId);

          const nextPendingServerRequests = state.pendingServerRequests.filter(
            (request) => !projectThreadIds.has(request.threadId),
          );
          const nextPendingThreadLaunches = Object.fromEntries(
            Object.entries(state.pendingThreadLaunches).filter(
              ([threadId]) => !projectThreadIds.has(threadId),
            ),
          );
          const nextPendingLaunchSegments = Object.fromEntries(
            Object.entries(state.pendingLaunchSegments).filter(
              ([threadId]) => !projectThreadIds.has(threadId),
            ),
          );

          const { [projectId]: _draft, ...nextDraftContents } = state.draftContents;

          let nextView = state.view;
          if (state.view.kind === "draft" && state.view.projectId === projectId) {
            nextView = { kind: "home" };
          } else if (state.view.kind === "thread") {
            nextView = state.view.panes.reduce<AppView>((view, paneId) => {
              if (view.kind !== "thread") return view;
              const shouldRemove = isDraftPaneId(paneId)
                ? parseDraftProjectId(paneId) === projectId
                : projectThreadIds.has(paneId);
              return shouldRemove ? removePaneFromView(view, paneId) : view;
            }, state.view);
          }

          return {
            projects: nextProjects,
            threads: nextThreads,
            pendingServerRequests: nextPendingServerRequests,
            pendingThreadLaunches: nextPendingThreadLaunches,
            pendingLaunchSegments: nextPendingLaunchSegments,
            draftContents: nextDraftContents,
            view: nextView,
          };
        }),
      updateProjectDraftConfig: (projectId, draftConfig) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId ? { ...project, lastDraftConfig: draftConfig } : project,
          ),
        })),
      updateProjectScripts: (projectId, scripts) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId ? { ...project, scripts } : project,
          ),
        })),
      renameProject: (projectId, name) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === projectId ? { ...project, name } : project,
          ),
        })),
      openDraft: (projectId) => set({ view: { kind: "draft", projectId } }),
      openDraftSideBySide: (projectId) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            return { view: { kind: "draft", projectId } };
          }
          // Exit group view — save layout, new thread replaces the group
          if (state.view.activeGroupId) {
            return { groupLayouts: saveGroupLayout(state), view: { kind: "draft", projectId } };
          }
          const draftPaneId = makeDraftPaneId(projectId);
          const existing = state.view.panes;
          if (existing.includes(draftPaneId)) {
            return {};
          }
          if (state.view.paneLayout) {
            const layout = insertPaneInLayout(
              state.view.paneLayout,
              {
                path: [],
                axis: "vertical",
                index:
                  state.view.paneLayout.kind === "split" &&
                  state.view.paneLayout.axis === "vertical"
                    ? state.view.paneLayout.children.length
                    : 1,
              },
              draftPaneId,
            );
            return {
              view: {
                kind: "thread",
                panes: collectPaneIds(layout),
                paneLayout: layout,
              },
            };
          }
          const rl = state.view.rowLayout;
          const newRl = rl ? [...rl.slice(0, -1), rl[rl.length - 1]! + 1] : undefined;
          return {
            view: {
              ...state.view,
              panes: [...existing, draftPaneId] as [string, ...string[]],
              ...(newRl ? { rowLayout: newRl } : {}),
            },
          };
        }),
      openHome: () => set({ view: { kind: "home" } }),
      openThread: (threadId) =>
        set((state) => {
          // If in group view, check if the thread belongs to the active group
          if (state.view.kind === "thread" && state.view.activeGroupId) {
            const thread = state.threads.find((t) => t.id === threadId);
            if (thread?.groupId === state.view.activeGroupId) {
              // Same group: add to panes if not already there
              if (state.view.panes.includes(threadId)) {
                const cleared = clearFinishedAndDone(state.threads, [threadId]);
                return cleared ? { threads: cleared } : {};
              }
              const layout = currentPaneLayout(state.view);
              const insertTarget =
                layout.kind === "split" && layout.axis === "vertical"
                  ? {
                      path: [] as number[],
                      axis: "vertical" as const,
                      index: layout.children.length,
                    }
                  : { path: [] as number[], axis: "vertical" as const, index: 1 };
              const newLayout = insertPaneInLayout(layout, insertTarget, threadId);
              const nextView: AppView = {
                kind: "thread",
                panes: collectPaneIds(newLayout),
                paneLayout: newLayout,
                activeGroupId: state.view.activeGroupId,
              };
              const cleared = clearFinishedAndDone(state.threads, nextView.panes);
              return cleared ? { view: nextView, threads: cleared } : { view: nextView };
            }
            // Different group or no group: save layout and exit group view
            const nextView: AppView = { kind: "thread", panes: [threadId] };
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            const gl = saveGroupLayout(state);
            return cleared
              ? { groupLayouts: gl, view: nextView, threads: cleared }
              : { groupLayouts: gl, view: nextView };
          }

          // If thread belongs to a group, open the whole group
          const clickedThread = state.threads.find((t) => t.id === threadId);
          if (clickedThread?.groupId) {
            const gl = state.view.kind === "thread" ? saveGroupLayout(state) : state.groupLayouts;
            const groupId = clickedThread.groupId;
            const groupThreads = state.threads.filter(
              (t) => t.groupId === groupId && !t.done && !t.archived,
            );
            if (groupThreads.length >= 2) {
              const saved = gl[groupId];
              let paneIds: [string, ...string[]];
              if (saved) {
                const validIds = new Set(groupThreads.map((t) => t.id));
                const restored = saved.panes.filter((id) => validIds.has(id));
                for (const t of groupThreads) {
                  if (!restored.includes(t.id)) restored.push(t.id);
                }
                paneIds = (restored.length > 0 ? restored : groupThreads.map((t) => t.id)) as [
                  string,
                  ...string[],
                ];
              } else {
                paneIds = groupThreads.map((t) => t.id) as [string, ...string[]];
              }
              const nextView: AppView = { kind: "thread", panes: paneIds, activeGroupId: groupId };
              const cleared = clearFinishedAndDone(state.threads, paneIds);
              return cleared
                ? { groupLayouts: gl, view: nextView, threads: cleared }
                : { groupLayouts: gl, view: nextView };
            }
          }

          if (state.view.kind === "thread") {
            if (state.view.panes.includes(threadId)) {
              const cleared = clearFinishedAndDone(state.threads, [threadId]);
              return cleared ? { threads: cleared } : {};
            }
            const nextView = replacePaneInView(state.view, state.view.panes[0]!, threadId);
            const nextPanes = nextView.kind === "thread" ? nextView.panes : [threadId];
            const cleared = clearFinishedAndDone(state.threads, nextPanes);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          const nextView: AppView = { kind: "thread", panes: [threadId] };
          const cleared = clearFinishedAndDone(state.threads, [threadId]);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      openThreadSideBySide: (threadId) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            const nextView: AppView = { kind: "thread", panes: [threadId] };
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          const existing = state.view.panes;
          if (existing.includes(threadId)) {
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            return cleared ? { threads: cleared } : {};
          }
          if (state.view.paneLayout) {
            const layout = insertPaneInLayout(
              state.view.paneLayout,
              {
                path: [],
                axis: "vertical",
                index:
                  state.view.paneLayout.kind === "split" &&
                  state.view.paneLayout.axis === "vertical"
                    ? state.view.paneLayout.children.length
                    : 1,
              },
              threadId,
            );
            const panes = collectPaneIds(layout);
            const nextView: AppView = {
              kind: "thread",
              panes,
              paneLayout: layout,
              ...(state.view.activeGroupId ? { activeGroupId: state.view.activeGroupId } : {}),
            };
            const cleared = clearFinishedAndDone(state.threads, panes);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          const nextPanes = [...existing, threadId] as [string, ...string[]];
          const rl = state.view.rowLayout;
          const newRl = rl ? [...rl.slice(0, -1), rl[rl.length - 1]! + 1] : undefined;
          const nextView: AppView = {
            ...state.view,
            panes: nextPanes,
            ...(newRl ? { rowLayout: newRl } : {}),
          };
          const cleared = clearFinishedAndDone(state.threads, nextPanes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      openGroupView: (groupId) =>
        set((state) => {
          // Save current group layout if switching from another group
          const gl = saveGroupLayout(state);

          const groupThreads = state.threads.filter(
            (t) => t.groupId === groupId && !t.done && !t.archived,
          );
          if (groupThreads.length === 0) return {};

          // Restore saved layout if available
          const saved = gl[groupId] ?? state.groupLayouts[groupId];
          if (saved) {
            // Filter saved panes to only include threads still in the group
            const validIds = new Set(groupThreads.map((t) => t.id));
            const restoredPanes = saved.panes.filter((id) => validIds.has(id));
            // Add any new group threads not in the saved layout
            for (const t of groupThreads) {
              if (!restoredPanes.includes(t.id)) restoredPanes.push(t.id);
            }
            if (restoredPanes.length > 0) {
              let paneLayout = saved.paneLayout;
              if (paneLayout) {
                const savedPaneIds = collectPaneIds(paneLayout);
                for (const paneId of savedPaneIds) {
                  if (validIds.has(paneId)) continue;
                  const nextLayout = removePaneFromLayout(paneLayout, paneId);
                  if (!nextLayout) {
                    paneLayout = undefined;
                    break;
                  }
                  paneLayout = nextLayout;
                }

                if (paneLayout) {
                  const layoutPaneIds = new Set(collectPaneIds(paneLayout));
                  for (const paneId of restoredPanes) {
                    if (layoutPaneIds.has(paneId)) continue;
                    paneLayout = insertPaneInLayout(
                      paneLayout,
                      paneLayout.kind === "split" && paneLayout.axis === "vertical"
                        ? {
                            path: [],
                            axis: "vertical",
                            index: paneLayout.children.length,
                          }
                        : { path: [], axis: "vertical", index: 1 },
                      paneId,
                    );
                    layoutPaneIds.add(paneId);
                  }

                  const paneIds = collectPaneIds(paneLayout);
                  const nextView: AppView = {
                    kind: "thread",
                    panes: paneIds,
                    paneLayout,
                    activeGroupId: groupId,
                  };
                  const cleared = clearFinishedAndDone(state.threads, paneIds);
                  return cleared
                    ? { groupLayouts: gl, view: nextView, threads: cleared }
                    : { groupLayouts: gl, view: nextView };
                }
              }

              const paneIds = restoredPanes as [string, ...string[]];
              const nextView: AppView = { kind: "thread", panes: paneIds, activeGroupId: groupId };
              const cleared = clearFinishedAndDone(state.threads, paneIds);
              return cleared
                ? { groupLayouts: gl, view: nextView, threads: cleared }
                : { groupLayouts: gl, view: nextView };
            }
          }

          const paneIds = groupThreads.map((t) => t.id) as [string, ...string[]];
          const nextView: AppView = { kind: "thread", panes: paneIds, activeGroupId: groupId };
          const cleared = clearFinishedAndDone(state.threads, paneIds);
          return cleared
            ? { groupLayouts: gl, view: nextView, threads: cleared }
            : { groupLayouts: gl, view: nextView };
        }),
      closeGroupView: () =>
        set((state) => {
          if (state.view.kind !== "thread" || !state.view.activeGroupId) return {};
          return { groupLayouts: saveGroupLayout(state), view: { kind: "home" } };
        }),
      replaceSecondPane: (threadId) =>
        set((state) => {
          if (state.view.kind !== "thread" || state.view.panes.length < 2) {
            return {};
          }
          if (state.view.panes.includes(threadId)) {
            return {};
          }
          const nextView = replacePaneInView(state.view, state.view.panes[1]!, threadId);
          const nextPanes = nextView.kind === "thread" ? nextView.panes : [threadId];
          const cleared = clearFinishedAndDone(state.threads, nextPanes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      replacePaneAtIndex: (threadId, index) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            const nextView: AppView = { kind: "thread", panes: [threadId] };
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          const existing = state.view.panes;
          if (existing.includes(threadId) || index < 0 || index >= existing.length) {
            return {};
          }
          const nextPanes = [...existing] as [string, ...string[]];
          nextPanes[index] = threadId;
          const nextView: AppView = { ...state.view, panes: nextPanes };
          const cleared = clearFinishedAndDone(state.threads, nextPanes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      insertPaneAtIndex: (threadId, index, edge) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            const nextView: AppView = { kind: "thread", panes: [threadId] };
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          const existing = state.view.panes;
          if (existing.includes(threadId)) {
            return {};
          }
          const clampedIndex = Math.max(0, Math.min(existing.length, index));
          const nextPanes = [...existing];
          nextPanes.splice(clampedIndex, 0, threadId);
          const newRl = rowLayoutAfterInsert(
            state.view.rowLayout,
            existing.length,
            clampedIndex,
            edge,
          );

          const nextView: AppView = {
            ...state.view,
            panes: nextPanes as [string, ...string[]],
            ...(newRl ? { rowLayout: newRl } : {}),
          };
          const cleared = clearFinishedAndDone(state.threads, nextPanes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      movePaneToIndex: (paneId, targetIndex, edge) =>
        set((state) => {
          if (state.view.kind !== "thread") return {};
          const existing = state.view.panes;
          const sourceIndex = existing.indexOf(paneId);
          if (sourceIndex === -1) return {};
          const nextPanes = [...existing];
          nextPanes.splice(sourceIndex, 1);
          const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
          const clampedIndex = Math.max(0, Math.min(nextPanes.length, adjustedIndex));
          nextPanes.splice(clampedIndex, 0, paneId);
          const remainingLayout = rowLayoutAfterRemove(state.view, new Set([sourceIndex]));
          const nextRowLayout = rowLayoutAfterInsert(
            remainingLayout,
            nextPanes.length - 1,
            clampedIndex,
            edge,
          );
          return {
            view: {
              ...state.view,
              panes: nextPanes as [string, ...string[]],
              ...(nextRowLayout ? { rowLayout: nextRowLayout } : {}),
            },
          };
        }),
      replacePaneById: (threadId, targetPaneId) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            const nextView: AppView = { kind: "thread", panes: [threadId] };
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          if (state.view.panes.includes(threadId) || !state.view.panes.includes(targetPaneId)) {
            return {};
          }
          const nextView = replacePaneInView(state.view, targetPaneId, threadId);
          const panes = nextView.kind === "thread" ? nextView.panes : [threadId];
          const cleared = clearFinishedAndDone(state.threads, panes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      splitPaneById: (threadId, targetPaneId, edge) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            const nextView: AppView = { kind: "thread", panes: [threadId] };
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          if (state.view.panes.includes(threadId) || !state.view.panes.includes(targetPaneId)) {
            return {};
          }
          const layout = splitPaneInLayout(
            currentPaneLayout(state.view),
            targetPaneId,
            threadId,
            edge,
          );
          const panes = collectPaneIds(layout);
          const nextView: AppView = {
            kind: "thread",
            panes,
            paneLayout: layout,
            ...(state.view.activeGroupId ? { activeGroupId: state.view.activeGroupId } : {}),
          };
          const cleared = clearFinishedAndDone(state.threads, panes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      insertPaneAtLayoutTarget: (threadId, target) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            const nextView: AppView = { kind: "thread", panes: [threadId] };
            const cleared = clearFinishedAndDone(state.threads, [threadId]);
            return cleared ? { view: nextView, threads: cleared } : { view: nextView };
          }
          if (state.view.panes.includes(threadId)) return {};
          const layout = insertPaneInLayout(currentPaneLayout(state.view), target, threadId);
          const panes = collectPaneIds(layout);
          const nextView: AppView = {
            kind: "thread",
            panes,
            paneLayout: layout,
            ...(state.view.activeGroupId ? { activeGroupId: state.view.activeGroupId } : {}),
          };
          const cleared = clearFinishedAndDone(state.threads, panes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      movePaneToLayoutTarget: (paneId, target) =>
        set((state) => {
          if (state.view.kind !== "thread") return {};
          if (!state.view.panes.includes(paneId)) return {};
          if ("paneId" in target && target.paneId === paneId) return {};

          const layout = currentPaneLayout(state.view);
          const layoutWithoutPane = removePaneFromLayout(layout, paneId);
          if (!layoutWithoutPane) {
            return {};
          }

          const nextLayout =
            "paneId" in target
              ? splitPaneInLayout(layoutWithoutPane, target.paneId, paneId, target.edge)
              : insertPaneInLayout(
                  layoutWithoutPane,
                  adjustInsertTargetForRemoval(layout, paneId, target),
                  paneId,
                );
          return {
            view: {
              kind: "thread",
              panes: collectPaneIds(nextLayout),
              paneLayout: nextLayout,
              ...(state.view.activeGroupId ? { activeGroupId: state.view.activeGroupId } : {}),
            },
          };
        }),
      swapPanes: (firstPaneId, secondPaneId) =>
        set((state) => {
          if (state.view.kind !== "thread") return {};
          if (
            !state.view.panes.includes(firstPaneId) ||
            !state.view.panes.includes(secondPaneId) ||
            firstPaneId === secondPaneId
          ) {
            return {};
          }
          const layout = swapPaneIdsInLayout(
            currentPaneLayout(state.view),
            firstPaneId,
            secondPaneId,
          );
          return {
            view: {
              kind: "thread",
              panes: collectPaneIds(layout),
              paneLayout: layout,
              ...(state.view.activeGroupId ? { activeGroupId: state.view.activeGroupId } : {}),
            },
          };
        }),
      closePane: (threadId) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            return {};
          }
          // In group view, closing a pane removes the thread from the group
          const activeGid = state.view.activeGroupId;
          if (activeGid) {
            const threads = state.threads.map((t) =>
              t.id === threadId && t.groupId === activeGid
                ? { ...t, groupId: undefined, groupName: undefined }
                : t,
            );
            const nextView = removePaneFromView(state.view, threadId);
            // If only 1 pane left, dissolve group — clear groupId on remaining thread too
            if (nextView.kind === "thread" && nextView.panes.length <= 1) {
              const lastId = nextView.panes[0];
              const dissolvedThreads = threads.map((t) =>
                t.id === lastId && t.groupId === activeGid
                  ? { ...t, groupId: undefined, groupName: undefined }
                  : t,
              );
              return {
                threads: dissolvedThreads,
                view: { kind: "thread" as const, panes: nextView.panes } satisfies AppView,
              };
            }
            return { threads, view: nextView };
          }
          return { view: removePaneFromView(state.view, threadId) };
        }),
      replacePaneId: (oldId, newId) =>
        set((state) => {
          if (state.view.kind !== "thread") {
            return {};
          }
          const idx = state.view.panes.indexOf(oldId);
          if (idx === -1) return {};
          const nextView = replacePaneInView(state.view, oldId, newId);
          const nextPanes = nextView.kind === "thread" ? nextView.panes : [newId];
          const cleared = clearFinishedAndDone(state.threads, nextPanes);
          return cleared ? { view: nextView, threads: cleared } : { view: nextView };
        }),
      createThread: ({
        projectId,
        agentKind,
        config,
        prompt,
        worktreePath,
        worktreeBranch,
        groupId,
        groupName,
        replacePaneId: replacePaneIdParam,
      }) => {
        const now = new Date().toISOString();
        const thread: Thread = {
          id: crypto.randomUUID(),
          projectId,
          title: makeThreadTitle(prompt),
          agentKind,
          config,
          status: "launching",
          attention: "none",
          canResumeWithConfig: false,
          archived: false,
          done: false,
          ...(worktreePath ? { worktreePath } : {}),
          ...(worktreeBranch ? { worktreeBranch } : {}),
          ...(groupId ? { groupId } : {}),
          ...(groupName ? { groupName } : {}),
          createdAt: now,
          updatedAt: now,
        };

        set((state) => {
          let nextView: AppView;
          if (replacePaneIdParam && state.view.kind === "thread") {
            const idx = state.view.panes.indexOf(replacePaneIdParam);
            if (idx !== -1) {
              nextView = replacePaneInView(state.view, replacePaneIdParam, thread.id);
            } else {
              nextView = { kind: "thread", panes: [thread.id] };
            }
          } else {
            nextView = { kind: "thread", panes: [thread.id] };
          }
          return { threads: [thread, ...state.threads], view: nextView };
        });

        return thread;
      },
      queueThreadLaunch: (threadId, prompt, segments) =>
        set((state) => ({
          pendingThreadLaunches: {
            ...state.pendingThreadLaunches,
            [threadId]: prompt,
          },
          ...(segments
            ? {
                pendingLaunchSegments: {
                  ...state.pendingLaunchSegments,
                  [threadId]: segments,
                },
              }
            : {}),
        })),
      consumeThreadLaunch: (threadId) =>
        set((state) => {
          if (!(threadId in state.pendingThreadLaunches)) {
            return {};
          }

          const { [threadId]: _removed, ...pendingThreadLaunches } = state.pendingThreadLaunches;
          const { [threadId]: _removedSeg, ...pendingLaunchSegments } = state.pendingLaunchSegments;
          return { pendingThreadLaunches, pendingLaunchSegments };
        }),
      deleteThread: (threadId) =>
        set((state) => {
          const nextThreads = state.threads.filter((thread) => thread.id !== threadId);

          if (nextThreads.length === state.threads.length) {
            return {};
          }

          let nextView = state.view;
          if (state.view.kind === "thread") {
            nextView = removePaneFromView(state.view, threadId);
          }

          return {
            threads: nextThreads,
            pendingServerRequests: state.pendingServerRequests.filter(
              (request) => request.threadId !== threadId,
            ),
            pendingThreadLaunches: Object.fromEntries(
              Object.entries(state.pendingThreadLaunches).filter(([id]) => id !== threadId),
            ),
            pendingLaunchSegments: Object.fromEntries(
              Object.entries(state.pendingLaunchSegments).filter(([id]) => id !== threadId),
            ),
            view: nextView,
          };
        }),
      renameThread: (threadId, title) =>
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? { ...thread, title, updatedAt: new Date().toISOString() }
              : thread,
          ),
        })),
      updateThreadConfig: (threadId, config) =>
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  config,
                  updatedAt: new Date().toISOString(),
                }
              : thread,
          ),
        })),
      updateThreadRuntime: (threadId, input) =>
        set((state) => {
          let changed = false;
          const isVisible = state.view.kind === "thread" && state.view.panes.includes(threadId);

          const threads: Thread[] = state.threads.map((thread): Thread => {
            if (thread.id !== threadId) {
              return thread;
            }

            // Promote idle → finished for non-visible threads that just
            // finished working. Also preserve "finished" when the supervisor
            // re-emits idle (it doesn't know about the finished status).
            let effectiveStatus = input.status;
            if (
              input.status === "idle" &&
              (thread.status === "working" || thread.status === "finished") &&
              !isVisible
            ) {
              effectiveStatus = "finished";
            }

            const sessionRefChanged =
              input.sessionRef !== undefined &&
              (thread.sessionRef?.providerSessionId !== input.sessionRef.providerSessionId ||
                thread.sessionRef?.discoveredAt !== input.sessionRef.discoveredAt);

            if (
              thread.status === effectiveStatus &&
              thread.attention === input.attention &&
              JSON.stringify(thread.config) === JSON.stringify(input.config ?? thread.config) &&
              thread.canResumeWithConfig === input.canResumeWithConfig &&
              !sessionRefChanged
            ) {
              return thread;
            }

            changed = true;
            return {
              ...thread,
              status: effectiveStatus,
              attention: input.attention,
              config: input.config ?? thread.config,
              canResumeWithConfig: input.canResumeWithConfig,
              ...(input.sessionRef ? { sessionRef: input.sessionRef } : {}),
              ...(input.status === "working" && thread.status !== "working"
                ? { updatedAt: new Date().toISOString() }
                : {}),
            };
          });

          return changed ? { threads } : {};
        }),
      addThreadServerRequest: (input) =>
        set((state) => {
          const nextRequest: PendingThreadServerRequest = {
            threadId: input.threadId,
            requestId: input.requestId,
            method: input.method,
            params: input.params,
            receivedAt: new Date().toISOString(),
          };
          const pendingServerRequests = [
            ...state.pendingServerRequests.filter(
              (request) =>
                request.threadId !== input.threadId || request.requestId !== input.requestId,
            ),
            nextRequest,
          ];

          return { pendingServerRequests };
        }),
      removeThreadServerRequest: (threadId, requestId) =>
        set((state) => ({
          pendingServerRequests: state.pendingServerRequests.filter(
            (request) => request.threadId !== threadId || request.requestId !== requestId,
          ),
        })),
      clearThreadServerRequests: (threadId) =>
        set((state) => ({
          pendingServerRequests: state.pendingServerRequests.filter(
            (request) => request.threadId !== threadId,
          ),
        })),
      archiveThread: (threadId) =>
        set((state) => {
          const thread = state.threads.find((t) => t.id === threadId);
          if (!thread || thread.archived) return {};

          const threads = state.threads.map((t) =>
            t.id === threadId ? { ...t, archived: true, updatedAt: new Date().toISOString() } : t,
          );

          let nextView = state.view;
          if (state.view.kind === "thread") {
            nextView = removePaneFromView(state.view, threadId);
          }

          return { threads, view: nextView };
        }),
      unarchiveThread: (threadId) =>
        set((state) => {
          const thread = state.threads.find((t) => t.id === threadId);
          if (!thread || !thread.archived) return {};

          return {
            threads: state.threads.map((t) =>
              t.id === threadId
                ? { ...t, archived: false, updatedAt: new Date().toISOString() }
                : t,
            ),
          };
        }),
      markThreadDone: (threadId) =>
        set((state) => {
          const thread = state.threads.find((t) => t.id === threadId);
          if (!thread || thread.done) return {};

          const threads = state.threads.map((t) => (t.id === threadId ? { ...t, done: true } : t));

          let nextView = state.view;
          if (state.view.kind === "thread") {
            nextView = removePaneFromView(state.view, threadId);
          }

          return { threads, view: nextView };
        }),
      unmarkThreadDone: (threadId) =>
        set((state) => {
          const thread = state.threads.find((t) => t.id === threadId);
          if (!thread || !thread.done) return {};
          return {
            threads: state.threads.map((t) => (t.id === threadId ? { ...t, done: false } : t)),
          };
        }),
      purgeStaleArchivedThreads: (maxAgeDays) =>
        set((state) => {
          const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
          const nextThreads = state.threads.filter(
            (t) => !t.archived || new Date(t.updatedAt).getTime() > cutoff,
          );
          if (nextThreads.length === state.threads.length) return {};
          return { threads: nextThreads };
        }),
      markThreadExited: (threadId) =>
        set((state) => {
          let changed = false;

          const threads: Thread[] = state.threads.map((thread): Thread => {
            if (thread.id !== threadId) {
              return thread;
            }

            if (thread.status === "inactive" && thread.attention === "none") {
              return thread;
            }

            changed = true;
            return {
              ...thread,
              status: "inactive",
              attention: "none",
            };
          });

          return changed
            ? {
                threads,
                pendingServerRequests: state.pendingServerRequests.filter(
                  (request) => request.threadId !== threadId,
                ),
              }
            : {
                pendingServerRequests: state.pendingServerRequests.filter(
                  (request) => request.threadId !== threadId,
                ),
              };
        }),
      touchThread: (threadId) =>
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId ? { ...thread, updatedAt: new Date().toISOString() } : thread,
          ),
        })),
      reconcileRuntimeSnapshots: (snapshots) =>
        set((state) => {
          const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.threadId, snapshot]));
          let changed = false;

          const threads = state.threads.map((thread) => {
            const snapshot = snapshotsById.get(thread.id);

            if (snapshot) {
              const sessionRefChanged =
                (thread.sessionRef?.providerSessionId ?? "") !==
                  (snapshot.sessionRef?.providerSessionId ?? "") ||
                (thread.sessionRef?.discoveredAt ?? "") !==
                  (snapshot.sessionRef?.discoveredAt ?? "");

              if (
                thread.status === snapshot.status &&
                thread.attention === snapshot.attention &&
                JSON.stringify(thread.config) ===
                  JSON.stringify(snapshot.config ?? thread.config) &&
                thread.canResumeWithConfig === snapshot.canResumeWithConfig &&
                !sessionRefChanged
              ) {
                return thread;
              }

              changed = true;
              return {
                ...thread,
                status: snapshot.status,
                attention: snapshot.attention,
                config: snapshot.config ?? thread.config,
                canResumeWithConfig: snapshot.canResumeWithConfig,
                ...(snapshot.sessionRef ? { sessionRef: snapshot.sessionRef } : {}),
              };
            }

            // Preserve threads that are already terminal or still being started —
            // the supervisor may not have registered a session yet for "launching"
            // threads, so resetting them to "inactive" would trigger a false
            // auto-reopen loop.
            if (
              thread.status === "inactive" ||
              thread.status === "error" ||
              thread.status === "launching"
            ) {
              return thread;
            }

            changed = true;
            return {
              ...thread,
              status: "inactive" as ThreadStatus,
              attention: "none" as ThreadAttention,
            };
          });

          return changed ? { threads } : {};
        }),
      reorderProjects: (sourceId, targetId, placement) =>
        set((state) => {
          const projectIds = state.projects.map((project) => project.id);
          const reorderedIds = reorderIds(projectIds, sourceId, targetId, placement);

          if (reorderedIds === projectIds) {
            return {};
          }

          const projectsById = new Map(state.projects.map((project) => [project.id, project]));
          const projects = reorderedIds
            .map((id) => projectsById.get(id))
            .filter((project): project is Project => project !== undefined);

          return { projects };
        }),
      reorderThreads: (sourceId, targetId, placement) =>
        set((state) => {
          const threads = reorderThreadsInProject(state.threads, sourceId, targetId, placement);

          if (threads === state.threads) {
            return {};
          }

          return { threads };
        }),
      reorderThreadBlock: (blockIds, targetId, placement) =>
        set((state) => {
          const threads = reorderThreadBlockInProject(state.threads, blockIds, targetId, placement);

          if (threads === state.threads) {
            return {};
          }

          return { threads };
        }),
      reorderPanes: (sourceId, targetId, placement) =>
        set((state) => {
          if (state.view.kind !== "thread") return {};
          const reordered = reorderIds(state.view.panes, sourceId, targetId, placement);
          if (reordered === state.view.panes) return {};
          return { view: { ...state.view, panes: reordered as [string, ...string[]] } };
        }),
      saveDraftContent: (projectId, content) =>
        set((state) => ({
          draftContents: { ...state.draftContents, [projectId]: content },
        })),
      clearDraftContent: (projectId) =>
        set((state) => {
          if (!(projectId in state.draftContents)) return {};
          const { [projectId]: _, ...rest } = state.draftContents;
          return { draftContents: rest };
        }),
    }),
    {
      name: "lightcode-app-v2",
      version: 4,
      storage: createDbStorage(),
      merge: (persistedState, currentState) => {
        const state =
          (persistedState as (Partial<AppStoreState> & { threads?: Thread[] }) | undefined) ??
          ({} as Partial<AppStoreState>);

        return {
          ...currentState,
          ...state,
          threads: (state.threads ?? currentState.threads).map((t) => ({
            ...normalizeStoredThreadStatus(t),
            done: t.done ?? false,
          })),
        };
      },
      partialize: (state) => ({
        projects: state.projects,
        threads: state.threads,
        view: state.view,
        groupLayouts: state.groupLayouts,
      }),
    },
  ),
);
