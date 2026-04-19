import { startTransition } from "react";
import { makeDraftPaneId } from "@/shared/paneId";
import { useAppStore } from "@/renderer/state/appStore";
import type { DragSourceData, PaneDropIndicator } from "@/renderer/dnd";

export function useDndHandlers() {
  const projects = useAppStore((s) => s.projects);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const reorderThreads = useAppStore((s) => s.reorderThreads);
  const replacePaneById = useAppStore((s) => s.replacePaneById);
  const splitPaneById = useAppStore((s) => s.splitPaneById);
  const insertPaneAtLayoutTarget = useAppStore((s) => s.insertPaneAtLayoutTarget);
  const movePaneToLayoutTarget = useAppStore((s) => s.movePaneToLayoutTarget);
  const swapPanes = useAppStore((s) => s.swapPanes);

  function handleSortEnd(
    source: DragSourceData,
    initialIndex: number,
    finalIndex: number,
    _initialGroup: string | undefined,
    _finalGroup: string | undefined,
  ) {
    if (initialIndex === finalIndex) return;

    if (source.type === "project") {
      const projectId = source.projectId;
      const projectIds = projects.map((p) => p.id);
      const targetId = projectIds[finalIndex];
      if (!targetId || targetId === projectId) return;
      const placement = initialIndex < finalIndex ? ("after" as const) : ("before" as const);
      startTransition(() => reorderProjects(projectId, targetId, placement));
    } else if (source.type === "thread") {
      const allThreads = useAppStore.getState().threads;
      const groupThreads = allThreads.filter(
        (t) =>
          t.projectId === source.projectId && (t.worktreePath ?? undefined) === source.worktreePath,
      );
      const targetThread = groupThreads[finalIndex];
      if (!targetThread || targetThread.id === source.threadId) return;
      const placement = initialIndex < finalIndex ? ("after" as const) : ("before" as const);
      startTransition(() => reorderThreads(source.threadId, targetThread.id, placement));
    }
  }

  function handlePaneDrop(source: DragSourceData, target: PaneDropIndicator | null) {
    if (!target) return;
    const currentView = useAppStore.getState().view;
    if (currentView.kind !== "thread") return;
    const panes = currentView.panes;

    if (source.type === "thread") {
      const threadId = source.threadId;
      if (panes.includes(threadId)) return;
      startTransition(() => {
        if (target.kind === "replace") replacePaneById(threadId, target.paneId);
        else if (target.kind === "split-pane") splitPaneById(threadId, target.paneId, target.edge);
        else insertPaneAtLayoutTarget(threadId, target.target);

        // If in group view, add dropped thread to the group
        if (currentView.activeGroupId) {
          const match = useAppStore
            .getState()
            .threads.find((t) => t.groupId === currentView.activeGroupId);
          const groupName = match?.groupName ?? match?.title;
          useAppStore.setState((state) => ({
            threads: state.threads.map((t) =>
              t.id === threadId
                ? {
                    ...t,
                    groupId: currentView.activeGroupId,
                    ...(groupName ? { groupName } : {}),
                  }
                : t,
            ),
          }));
        }
      });
    } else if (source.type === "pane") {
      const sourcePaneId = source.paneId;
      if (target.kind === "replace") {
        if (sourcePaneId === target.paneId) return;
        startTransition(() => swapPanes(sourcePaneId, target.paneId));
      } else if (target.kind === "split-pane") {
        if (sourcePaneId === target.paneId) return;
        startTransition(() =>
          movePaneToLayoutTarget(sourcePaneId, { paneId: target.paneId, edge: target.edge }),
        );
      } else {
        startTransition(() => movePaneToLayoutTarget(sourcePaneId, target.target));
      }
    } else if (source.type === "new-thread") {
      const draftPaneId = makeDraftPaneId(source.projectId);
      if (panes.includes(draftPaneId)) return;
      startTransition(() => {
        if (target.kind === "replace") replacePaneById(draftPaneId, target.paneId);
        else if (target.kind === "split-pane")
          splitPaneById(draftPaneId, target.paneId, target.edge);
        else insertPaneAtLayoutTarget(draftPaneId, target.target);
      });
    }
  }

  return { handleSortEnd, handlePaneDrop };
}
