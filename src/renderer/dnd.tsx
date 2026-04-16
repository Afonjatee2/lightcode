import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, KeyboardSensor, PointerSensor } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { makeDraftPaneId } from "../shared/paneId";
import type { PaneLayout, PaneLayoutAxis, PaneLayoutInsertTarget } from "../shared/paneLayout";
import { findPanePath } from "../shared/paneLayout";
import { useFileEditorStore } from "./state/fileEditorStore";

export type DragSourceData =
  | { type: "project"; projectId: string }
  | { type: "thread"; threadId: string; projectId: string; worktreePath?: string }
  | { type: "worktree-group"; worktreePath: string; projectId: string; threadIds: string[] }
  | { type: "pane"; paneId: string }
  | { type: "new-thread"; projectId: string }
  | { type: "editor-tab"; path: string };

export type PaneDropIndicator =
  | { kind: "replace"; paneId: string }
  | { kind: "split-pane"; paneId: string; edge: "left" | "right" | "top" | "bottom" }
  | { kind: "insert-split"; target: PaneLayoutInsertTarget; zoneId: string };

type DndSnapshot = {
  source: DragSourceData | null;
  paneIndicator: PaneDropIndicator | null;
};
const EMPTY_DND_SNAPSHOT: DndSnapshot = {
  source: null,
  paneIndicator: null,
};

let dndSnapshot: DndSnapshot = EMPTY_DND_SNAPSHOT;
const dndListeners = new Set<() => void>();

function subscribeDndStore(listener: () => void) {
  dndListeners.add(listener);
  return () => dndListeners.delete(listener);
}

function emitDndStore() {
  for (const listener of dndListeners) {
    listener();
  }
}

function updateDndSnapshot(nextSnapshot: DndSnapshot) {
  if (
    dndSnapshot.source === nextSnapshot.source &&
    dndSnapshot.paneIndicator === nextSnapshot.paneIndicator
  ) {
    return;
  }
  dndSnapshot = nextSnapshot;
  emitDndStore();
}

function setDragSource(source: DragSourceData | null) {
  updateDndSnapshot({ ...dndSnapshot, source });
}

function setPaneIndicatorState(paneIndicator: PaneDropIndicator | null) {
  updateDndSnapshot({ ...dndSnapshot, paneIndicator });
}

function useDndSelector<T>(selector: (snapshot: DndSnapshot) => T) {
  return useSyncExternalStore(
    subscribeDndStore,
    () => selector(dndSnapshot),
    () => selector(EMPTY_DND_SNAPSHOT),
  );
}

export function useDragSource() {
  return useDndSelector((snapshot) => snapshot.source);
}

export function useIsDraggingPane(paneId: string) {
  return useDndSelector(
    (snapshot) => snapshot.source?.type === "pane" && snapshot.source.paneId === paneId,
  );
}

export function useIsDraggingThread(threadId: string) {
  return useDndSelector(
    (snapshot) => snapshot.source?.type === "thread" && snapshot.source.threadId === threadId,
  );
}

export function useIsDraggingProject(projectId: string) {
  return useDndSelector(
    (snapshot) => snapshot.source?.type === "project" && snapshot.source.projectId === projectId,
  );
}

export function useIsDraggingWorktreeGroup(worktreePath: string) {
  return useDndSelector(
    (snapshot) =>
      snapshot.source?.type === "worktree-group" && snapshot.source.worktreePath === worktreePath,
  );
}

export function useIsDraggingEditorTab(path: string) {
  return useDndSelector(
    (snapshot) => snapshot.source?.type === "editor-tab" && snapshot.source.path === path,
  );
}

export function usePaneDropIndicatorState(paneId: string) {
  return useDndSelector((snapshot) => {
    const paneIndicator = snapshot.paneIndicator;
    if (!paneIndicator) return false as const;
    if (paneIndicator.kind === "replace" && paneIndicator.paneId === paneId)
      return "replace" as const;
    if (paneIndicator.kind !== "split-pane" || paneIndicator.paneId !== paneId)
      return false as const;
    if (paneIndicator.edge === "left") return "insert-left" as const;
    if (paneIndicator.edge === "right") return "insert-right" as const;
    if (paneIndicator.edge === "top") return "insert-top" as const;
    return "insert-bottom" as const;
  });
}

export function useIsInsertSplitHighlighted(zoneId: string) {
  return useDndSelector((snapshot) => {
    const paneIndicator = snapshot.paneIndicator;
    return paneIndicator?.kind === "insert-split" && paneIndicator.zoneId === zoneId;
  });
}

export function useIsRootInsertHighlighted(zoneId: string) {
  return useDndSelector((snapshot) => {
    const paneIndicator = snapshot.paneIndicator;
    return paneIndicator?.kind === "insert-split" && paneIndicator.zoneId === zoneId;
  });
}

const EDGE_THRESHOLD = 0.15;

function getEdgeZone(
  element: Element,
  pointerX: number,
  pointerY: number,
): "left" | "right" | "top" | "bottom" | "center" {
  const rect = element.getBoundingClientRect();
  const xFrac = (pointerX - rect.left) / rect.width;
  const yFrac = (pointerY - rect.top) / rect.height;

  const distLeft = xFrac;
  const distRight = 1 - xFrac;
  const distTop = yFrac;
  const distBottom = 1 - yFrac;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist > EDGE_THRESHOLD) return "center";
  if (minDist === distLeft) return "left";
  if (minDist === distRight) return "right";
  if (minDist === distTop) return "top";
  return "bottom";
}

function computePaneIndicator(
  sourceType: string,
  paneId: string,
  layout: PaneLayout,
  element: Element,
  pointerX: number,
  pointerY: number,
  sourcePaneId?: string,
): PaneDropIndicator | null {
  const zone = getEdgeZone(element, pointerX, pointerY);
  if (sourceType === "pane" && sourcePaneId === paneId) return null;
  if (zone === "center") {
    return { kind: "replace", paneId };
  }
  const siblingInsert = resolveSiblingInsertTarget(layout, paneId, zone);
  if (siblingInsert) {
    return siblingInsert;
  }
  return { kind: "split-pane", paneId, edge: zone };
}

function getNodeAtPath(layout: PaneLayout, path: number[]): PaneLayout | null {
  let current: PaneLayout = layout;
  for (const index of path) {
    if (current.kind !== "split") return null;
    const next = current.children[index];
    if (!next) return null;
    current = next;
  }
  return current;
}

function resolveSiblingInsertTarget(
  layout: PaneLayout,
  paneId: string,
  zone: "left" | "right" | "top" | "bottom",
): Extract<PaneDropIndicator, { kind: "insert-split" }> | null {
  const panePath = findPanePath(layout, paneId);
  if (!panePath || panePath.length === 0) return null;

  const parentPath = panePath.slice(0, -1);
  const parent = getNodeAtPath(layout, parentPath);
  if (parent?.kind !== "split") return null;

  const childIndex = panePath[panePath.length - 1]!;
  if (zone === "left" && parent.axis === "vertical" && childIndex > 0) {
    const index = childIndex;
    return {
      kind: "insert-split",
      target: { path: parentPath, axis: "vertical", index },
      zoneId: `split-divider:vertical:${parentPath.join("-")}:${index}`,
    };
  }
  if (zone === "right" && parent.axis === "vertical" && childIndex < parent.children.length - 1) {
    const index = childIndex + 1;
    return {
      kind: "insert-split",
      target: { path: parentPath, axis: "vertical", index },
      zoneId: `split-divider:vertical:${parentPath.join("-")}:${index}`,
    };
  }
  if (zone === "top" && parent.axis === "horizontal" && childIndex > 0) {
    const index = childIndex;
    return {
      kind: "insert-split",
      target: { path: parentPath, axis: "horizontal", index },
      zoneId: `split-divider:horizontal:${parentPath.join("-")}:${index}`,
    };
  }
  if (
    zone === "bottom" &&
    parent.axis === "horizontal" &&
    childIndex < parent.children.length - 1
  ) {
    const index = childIndex + 1;
    return {
      kind: "insert-split",
      target: { path: parentPath, axis: "horizontal", index },
      zoneId: `split-divider:horizontal:${parentPath.join("-")}:${index}`,
    };
  }

  return null;
}

export function AppDndProvider(props: {
  children: React.ReactNode;
  onSidebarSortEnd: (
    source: DragSourceData,
    initialIndex: number,
    finalIndex: number,
    initialGroup: string | undefined,
    finalGroup: string | undefined,
  ) => void;
  onPaneDrop: (source: DragSourceData, target: PaneDropIndicator | null) => void;
  paneThreadIds: string[];
  paneLayout: PaneLayout;
}) {
  const pointer = useRef({ x: 0, y: 0 });
  const paneIndicatorRef = useRef<PaneDropIndicator | null>(null);
  const paneThreadIdsRef = useRef(props.paneThreadIds);
  paneThreadIdsRef.current = props.paneThreadIds;

  const activePaneTarget = useRef<{
    paneId: string;
    element: Element;
    sourceType: string;
    sourcePaneId?: string;
  } | null>(null);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
    }
    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
    return () => document.removeEventListener("pointermove", onPointerMove, { capture: true });
  }, []);

  function updatePaneIndicator() {
    const target = activePaneTarget.current;
    if (!target) return;
    const next = computePaneIndicator(
      target.sourceType,
      target.paneId,
      props.paneLayout,
      target.element,
      pointer.current.x,
      pointer.current.y,
      target.sourcePaneId,
    );
    setPaneIndicatorState(next);
    paneIndicatorRef.current = next;
  }

  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
      }),
      KeyboardSensor,
    ],
    [],
  );

  return (
    <DragDropProvider
      sensors={sensors}
      onDragStart={(event) => {
        const data = event.operation.source?.data as DragSourceData | undefined;
        if (data) setDragSource(data);
      }}
      onDragMove={() => {
        if (activePaneTarget.current) {
          updatePaneIndicator();
        }
      }}
      onDragOver={(event) => {
        const target = event.operation.target;
        const data = event.operation.source?.data as DragSourceData | undefined;
        if (!data || !target) {
          activePaneTarget.current = null;
          setPaneIndicatorState(null);
          paneIndicatorRef.current = null;
          return;
        }

        const targetData = target.data as Record<string, unknown> | undefined;
        const targetType = targetData?.type as string | undefined;

        if (
          targetType === "pane-drop-zone" &&
          (data.type === "thread" || data.type === "pane" || data.type === "new-thread")
        ) {
          if (data.type === "new-thread") {
            const draftId = makeDraftPaneId(data.projectId);
            if (paneThreadIdsRef.current.includes(draftId)) {
              activePaneTarget.current = null;
              setPaneIndicatorState(null);
              paneIndicatorRef.current = null;
              return;
            }
          }

          const paneId = targetData?.paneId as string | undefined;
          const element = target.element;
          if (paneId && element) {
            const sourcePaneId =
              data.type === "thread"
                ? data.threadId
                : data.type === "pane"
                  ? data.paneId
                  : undefined;
            activePaneTarget.current = {
              paneId,
              element,
              sourceType: data.type,
              ...(sourcePaneId ? { sourcePaneId } : {}),
            };
            updatePaneIndicator();
          }
          return;
        }

        if (
          targetType === "pane-insert-zone" &&
          (data.type === "thread" || data.type === "pane" || data.type === "new-thread")
        ) {
          activePaneTarget.current = null;
          const axis = targetData?.axis as PaneLayoutAxis | undefined;
          const index = targetData?.index as number | undefined;
          const zoneId = targetData?.zoneId as string | undefined;
          const path = Array.isArray(targetData?.path) ? (targetData?.path as number[]) : undefined;
          if (
            path &&
            index !== undefined &&
            zoneId &&
            (axis === "horizontal" || axis === "vertical")
          ) {
            const next: PaneDropIndicator = {
              kind: "insert-split",
              target: { path, axis, index },
              zoneId,
            };
            setPaneIndicatorState(next);
            paneIndicatorRef.current = next;
          } else {
            setPaneIndicatorState(null);
            paneIndicatorRef.current = null;
          }
          return;
        }

        activePaneTarget.current = null;
        setPaneIndicatorState(null);
        paneIndicatorRef.current = null;
      }}
      onDragEnd={(event) => {
        const src = event.operation.source;
        const data = src?.data as DragSourceData | undefined;

        if (!event.canceled && data) {
          if (
            (data.type === "pane" || data.type === "thread" || data.type === "new-thread") &&
            paneIndicatorRef.current
          ) {
            props.onPaneDrop(data, paneIndicatorRef.current);
          } else if (data.type === "editor-tab" && src && isSortable(src)) {
            useFileEditorStore.getState().reorderTabs(src.initialIndex, src.index);
          } else if (src && isSortable(src) && data.type !== "pane") {
            props.onSidebarSortEnd(
              data,
              src.initialIndex,
              src.index,
              src.initialGroup as string | undefined,
              src.group as string | undefined,
            );
          }
        }

        activePaneTarget.current = null;
        setDragSource(null);
        setPaneIndicatorState(null);
        paneIndicatorRef.current = null;
      }}
    >
      {props.children}
    </DragDropProvider>
  );
}
