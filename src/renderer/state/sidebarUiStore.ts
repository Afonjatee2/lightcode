import { create } from "zustand";
import { captureProductEvent } from "@/renderer/analytics/posthog";

const COLLAPSED_PROJECTS_STORAGE_KEY = "lightcode-collapsed-projects";

interface SidebarUiState {
  collapsedProjects: Record<string, boolean>;
  collapsedWorktrees: Record<string, boolean>;
  editingThreadId: string | null;
  setProjectCollapsed: (projectId: string, collapsed: boolean) => void;
  toggleProjectCollapsed: (projectId: string) => void;
  setWorktreeCollapsed: (key: string, collapsed: boolean) => void;
  toggleWorktreeCollapsed: (key: string) => void;
  setEditingThreadId: (id: string | null) => void;
}

function readCollapsedProjects(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeCollapsedProjects(collapsedProjects: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify(collapsedProjects));
  } catch {
    // ignored
  }
}

export const useSidebarUiStore = create<SidebarUiState>()((set) => ({
  collapsedProjects: readCollapsedProjects(),
  collapsedWorktrees: {},
  editingThreadId: null,

  setProjectCollapsed: (projectId, collapsed) =>
    set((state) => {
      if ((state.collapsedProjects[projectId] ?? false) === collapsed) return {};
      const collapsedProjects = { ...state.collapsedProjects, [projectId]: collapsed };
      writeCollapsedProjects(collapsedProjects);
      captureProductEvent("ui.project_group_toggled", { collapsed });
      return { collapsedProjects };
    }),
  toggleProjectCollapsed: (projectId) =>
    set((state) => {
      const collapsedProjects = {
        ...state.collapsedProjects,
        [projectId]: !(state.collapsedProjects[projectId] ?? false),
      };
      writeCollapsedProjects(collapsedProjects);
      captureProductEvent("ui.project_group_toggled", { collapsed: collapsedProjects[projectId] });
      return { collapsedProjects };
    }),
  setWorktreeCollapsed: (key, collapsed) =>
    set((state) => {
      if ((state.collapsedWorktrees[key] ?? false) === collapsed) return {};
      captureProductEvent("ui.worktree_group_toggled", { collapsed });
      return { collapsedWorktrees: { ...state.collapsedWorktrees, [key]: collapsed } };
    }),
  toggleWorktreeCollapsed: (key) =>
    set((state) => {
      const collapsed = !(state.collapsedWorktrees[key] ?? false);
      captureProductEvent("ui.worktree_group_toggled", { collapsed });
      return {
        collapsedWorktrees: {
          ...state.collapsedWorktrees,
          [key]: collapsed,
        },
      };
    }),
  setEditingThreadId: (editingThreadId) => set({ editingThreadId }),
}));

export function useIsProjectCollapsed(projectId: string): boolean {
  return useSidebarUiStore((s) => s.collapsedProjects[projectId] ?? false);
}

export function useIsWorktreeCollapsed(key: string): boolean {
  return useSidebarUiStore((s) => s.collapsedWorktrees[key] ?? false);
}
