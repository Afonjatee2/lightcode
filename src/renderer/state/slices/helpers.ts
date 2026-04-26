import type {
  AppView,
  Thread,
  ThreadAttention,
  ThreadConfig,
  ThreadStatus,
} from "@/shared/contracts";
import {
  buildPaneLayoutFromLegacy,
  collectPaneIds,
  removePaneFromLayout,
  replacePaneIdInLayout,
  type PaneLayout,
} from "@/shared/paneLayout";
import {
  addToRowLayout,
  insertRowInLayout,
  paneIndexToRowCol,
  removeIndicesFromRowLayout,
} from "@/shared/rowLayout";
import type { SavedGroupLayout } from "./types";

/**
 * Plan mode is a launch-time intent, not a persistent thread property.
 * Strip it so a thread that was first launched in plan mode resumes with default permission.
 */
export function stripPlanMode(config: ThreadConfig): ThreadConfig {
  if (config.mode !== "plan") {
    return config;
  }
  const { mode: _omit, ...rest } = config;
  return rest;
}

export function makeThreadTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

export function normalizeStoredThreadStatus(thread: Thread): Thread {
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
export function clearFinishedAndDone(threads: Thread[], panes: string[]): Thread[] | null {
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
export function rowLayoutAfterRemove(
  view: { rowLayout?: number[]; panes: string[] },
  removedIndices: Set<number>,
): number[] | undefined {
  if (!view.rowLayout) return undefined;
  const result = removeIndicesFromRowLayout(view.rowLayout, removedIndices);
  return result.length > 0 ? result : undefined;
}

export function rowLayoutAfterInsert(
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
export function viewAfterPaneRemoval(
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

export function currentPaneLayout(view: Extract<AppView, { kind: "thread" }>): PaneLayout {
  return view.paneLayout ?? buildPaneLayoutFromLegacy(view.panes, view.rowLayout);
}

export function saveGroupLayout(state: {
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

export function viewFromPaneLayout(
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

export function replacePaneInView(
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

export function removePaneFromView(
  view: Extract<AppView, { kind: "thread" }>,
  paneId: string,
): AppView {
  if (view.paneLayout) {
    return viewFromPaneLayout(removePaneFromLayout(view.paneLayout, paneId), view.activeGroupId);
  }

  const idx = view.panes.indexOf(paneId);
  const remaining = view.panes.filter((id) => id !== paneId);
  if (remaining.length === 0) return { kind: "home" };
  return viewAfterPaneRemoval(view, remaining, new Set(idx !== -1 ? [idx] : []));
}

export type { AppView, Thread, ThreadAttention, ThreadStatus };
