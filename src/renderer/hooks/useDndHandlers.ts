import { startTransition } from "react";
import { makeDraftPaneId } from "@/shared/paneId";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useProjectIds } from "@/renderer/state/useThread";
import type { DragSourceData, MainPanelDropSource, PaneDropIndicator } from "@/renderer/dnd";
import type { ReorderPlacement } from "@/renderer/state/reorder";
import { showFilesPanel, showGitReviewPanel } from "@/renderer/actions/panelActions";
import { showTerminalPanel } from "@/renderer/actions/terminalActions";

type ThreadDragSource = Extract<DragSourceData, { type: "thread" }>;

export function resolveThreadReorder(input: {
  threads: Thread[];
  source: ThreadDragSource;
  target: DragSourceData | null;
  initialIndex: number;
  finalIndex: number;
}): { targetId: string; placement: ReorderPlacement } | null {
  const { threads, source, target, initialIndex, finalIndex } = input;
  const targetThread =
    target?.type === "thread" &&
    target.projectId === source.projectId &&
    target.threadId !== source.threadId &&
    (source.sortGroup === undefined || target.sortGroup === source.sortGroup)
      ? target
      : null;

  if (targetThread) {
    const sourceIndex = source.sortIndex ?? initialIndex;
    const targetIndex = targetThread.sortIndex ?? finalIndex;
    return {
      targetId: targetThread.threadId,
      placement: sourceIndex < targetIndex ? "after" : "before",
    };
  }

  const projectWideSort = source.sortGroup?.startsWith("project-entries:") ?? false;
  const groupThreads = threads
    .filter(
      (t) =>
        t.projectId === source.projectId &&
        (projectWideSort || (t.worktreePath ?? undefined) === source.worktreePath),
    )
    .sort((a, b) => Number(b.starred) - Number(a.starred));
  const targetByIndex = groupThreads[finalIndex];
  if (!targetByIndex || targetByIndex.id === source.threadId) return null;

  return {
    targetId: targetByIndex.id,
    placement: initialIndex < finalIndex ? "after" : "before",
  };
}

export function useDndHandlers() {
  const projectIds = useProjectIds();
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
    target: DragSourceData | null,
  ) {
    if (source.type === "project") {
      if (initialIndex === finalIndex) return;
      const projectId = source.projectId;
      const targetId = projectIds[finalIndex];
      if (!targetId || targetId === projectId) return;
      const placement = initialIndex < finalIndex ? ("after" as const) : ("before" as const);
      startTransition(() => reorderProjects(projectId, targetId, placement));
    } else if (source.type === "thread") {
      const allThreads = useAppStore.getState().threads;
      const reorder = resolveThreadReorder({
        threads: allThreads,
        source,
        target,
        initialIndex,
        finalIndex,
      });
      if (!reorder) return;
      startTransition(() => reorderThreads(source.threadId, reorder.targetId, reorder.placement));
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

  function handleMainPanelDrop(source: MainPanelDropSource) {
    if (source.type === "project") {
      showFilesPanel(source.projectId);
    } else if (source.type === "worktree-group") {
      showFilesPanel(source.projectId, source.worktreePath);
    } else if (source.panel === "files") {
      showFilesPanel(source.projectId, source.worktreePath);
    } else if (source.panel === "git") {
      showGitReviewPanel(source.projectId, source.worktreePath);
    } else {
      showTerminalPanel(source.projectId, source.worktreePath);
    }
  }

  return { handleSortEnd, handlePaneDrop, handleMainPanelDrop };
}
