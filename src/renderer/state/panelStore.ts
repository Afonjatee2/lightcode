import { create } from "zustand";
import type { ThreadSortMode } from "@/renderer/views/MainView/parts/Sidebar/parts/sortMode";

export interface GitReviewContext {
  projectId: string;
  worktreePath?: string;
}

export interface PrReviewContext {
  projectId: string;
  worktreePath?: string;
  prNumber: number;
}

export interface FilesPanelContext {
  projectId: string;
  projectName: string;
  worktreePath?: string;
  rootLabel: string;
}

export type RightPanelTab = "git" | "files" | "terminal" | "browser";

interface PanelState {
  gitReviewContext: GitReviewContext | null;
  gitReviewAsPanel: boolean;
  gitOverlayOpen: boolean;
  prReviewContext: PrReviewContext | null;
  filesPanelContext: FilesPanelContext | null;
  rightPanelTab: RightPanelTab;
  browserPanelOpen: boolean;
  browserOverlayOpen: boolean;
  settingsOpen: boolean;
  projectSettingsId: string | null;
  threadSortMode: ThreadSortMode;
  threadSearchOpen: boolean;
  setGitReviewContext: (ctx: GitReviewContext | null) => void;
  setThreadSortMode: (mode: ThreadSortMode) => void;
  setGitReviewAsPanel: (v: boolean) => void;
  setGitOverlayOpen: (v: boolean) => void;
  setPrReviewContext: (ctx: PrReviewContext | null) => void;
  setFilesPanelContext: (ctx: FilesPanelContext | null) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setBrowserPanelOpen: (v: boolean) => void;
  setBrowserOverlayOpen: (v: boolean) => void;
  openBrowserPanel: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openProjectSettings: (projectId: string) => void;
  closeProjectSettings: () => void;
  openThreadSearch: () => void;
  closeThreadSearch: () => void;
  closeAllPanels: () => void;
}

const STORAGE_KEY = "lightcode-git-panel-context";

function loadInitialGitContext(): GitReviewContext | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const usePanelStore = create<PanelState>((set) => ({
  gitReviewContext: loadInitialGitContext(),
  gitReviewAsPanel: false,
  gitOverlayOpen: false,
  prReviewContext: null,
  filesPanelContext: null,
  rightPanelTab: "git",
  browserPanelOpen: false,
  browserOverlayOpen: false,
  settingsOpen: false,
  projectSettingsId: null,
  threadSortMode: "updated",
  threadSearchOpen: false,

  setGitReviewContext: (ctx) => {
    const prev = usePanelStore.getState().gitReviewContext;
    if (
      (prev === null && ctx === null) ||
      (prev !== null &&
        ctx !== null &&
        prev.projectId === ctx.projectId &&
        prev.worktreePath === ctx.worktreePath)
    ) {
      return;
    }
    if (ctx) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ gitReviewContext: ctx });
  },
  setGitReviewAsPanel: (v) =>
    set((state) => (state.gitReviewAsPanel === v ? {} : { gitReviewAsPanel: v })),
  setGitOverlayOpen: (v) =>
    set((state) => (state.gitOverlayOpen === v ? {} : { gitOverlayOpen: v })),
  setPrReviewContext: (ctx) =>
    set((state) => {
      const prev = state.prReviewContext;
      if (
        (prev === null && ctx === null) ||
        (prev !== null &&
          ctx !== null &&
          prev.projectId === ctx.projectId &&
          prev.worktreePath === ctx.worktreePath &&
          prev.prNumber === ctx.prNumber)
      ) {
        return {};
      }
      return { prReviewContext: ctx };
    }),
  setFilesPanelContext: (ctx) =>
    set((state) => {
      const prev = state.filesPanelContext;
      if (
        (prev === null && ctx === null) ||
        (prev !== null &&
          ctx !== null &&
          prev.projectId === ctx.projectId &&
          prev.projectName === ctx.projectName &&
          prev.worktreePath === ctx.worktreePath &&
          prev.rootLabel === ctx.rootLabel)
      ) {
        return {};
      }
      return { filesPanelContext: ctx };
    }),
  setRightPanelTab: (tab) =>
    set((state) => (state.rightPanelTab === tab ? {} : { rightPanelTab: tab })),
  setBrowserPanelOpen: (v) =>
    set((state) =>
      state.browserPanelOpen === v && (v || !state.browserOverlayOpen)
        ? {}
        : { browserPanelOpen: v, ...(v ? {} : { browserOverlayOpen: false }) },
    ),
  setBrowserOverlayOpen: (v) =>
    set((state) =>
      state.browserOverlayOpen === v
        ? {}
        : {
            browserOverlayOpen: v,
            ...(v ? { browserPanelOpen: true, rightPanelTab: "browser" as const } : {}),
          },
    ),
  openBrowserPanel: () =>
    set((state) =>
      state.browserPanelOpen && state.rightPanelTab === "browser"
        ? {}
        : { browserPanelOpen: true, rightPanelTab: "browser" as const },
    ),
  setThreadSortMode: (mode) =>
    set((state) => (state.threadSortMode === mode ? {} : { threadSortMode: mode })),
  openSettings: () => set((state) => (state.settingsOpen ? {} : { settingsOpen: true })),
  closeSettings: () => set((state) => (state.settingsOpen ? { settingsOpen: false } : {})),
  openProjectSettings: (projectId) =>
    set((state) => (state.projectSettingsId === projectId ? {} : { projectSettingsId: projectId })),
  closeProjectSettings: () =>
    set((state) => (state.projectSettingsId === null ? {} : { projectSettingsId: null })),
  openThreadSearch: () =>
    set((state) => (state.threadSearchOpen ? {} : { threadSearchOpen: true })),
  closeThreadSearch: () =>
    set((state) => (state.threadSearchOpen ? { threadSearchOpen: false } : {})),
  closeAllPanels: () => {
    localStorage.removeItem(STORAGE_KEY);
    set((state) => {
      if (
        state.gitReviewContext === null &&
        state.filesPanelContext === null &&
        !state.browserPanelOpen &&
        !state.browserOverlayOpen
      ) {
        return {};
      }
      return {
        gitReviewContext: null,
        filesPanelContext: null,
        browserPanelOpen: false,
        browserOverlayOpen: false,
      };
    });
  },
}));

// Narrow selectors — primitive returns, stable under Object.is.
export function useGitReviewProjectId(): string | undefined {
  return usePanelStore((s) => s.gitReviewContext?.projectId);
}
export function useGitReviewWorktreePath(): string | undefined {
  return usePanelStore((s) => s.gitReviewContext?.worktreePath);
}
export function useIsGitReviewPanel(): boolean {
  return usePanelStore((s) => s.gitReviewAsPanel);
}
export function useIsGitOverlayOpen(): boolean {
  return usePanelStore((s) => s.gitOverlayOpen);
}
export function useFilesPanelProjectId(): string | undefined {
  return usePanelStore((s) => s.filesPanelContext?.projectId);
}
export function useFilesPanelWorktreePath(): string | undefined {
  return usePanelStore((s) => s.filesPanelContext?.worktreePath);
}
export function useRightPanelTab(): RightPanelTab {
  return usePanelStore((s) => s.rightPanelTab);
}
