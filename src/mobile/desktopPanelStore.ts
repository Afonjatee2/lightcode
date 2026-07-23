import { create } from "zustand";
import type { RightPanelTab } from "@/renderer/state/panelStore";

export type DesktopPanelTab = Extract<
  RightPanelTab,
  "git" | "files" | "terminal" | "usage" | "notes" | "ports"
>;

interface DesktopPanelState {
  readonly open: boolean;
  readonly activeTab: DesktopPanelTab;
  readonly threadId: string | null;
  readonly initialFilePath: string | null;
  readonly initialFolderPath: string | null;
  readonly initialLineNumber: number | null;
  readonly openRequestKey: number;
  readonly show: (tab: DesktopPanelTab, threadId?: string | null) => void;
  readonly toggle: (tab: DesktopPanelTab, threadId?: string | null) => void;
  readonly showFile: (threadId: string, path: string, lineNumber?: number) => void;
  readonly showFolder: (threadId: string, path: string) => void;
  readonly setActiveTab: (tab: DesktopPanelTab) => void;
  readonly setThreadId: (threadId: string | null) => void;
  readonly close: () => void;
  readonly reset: () => void;
}

function nextThreadId(current: string | null, incoming?: string | null): string | null {
  return incoming === undefined ? current : incoming;
}

export const useDesktopPanelStore = create<DesktopPanelState>()((set) => ({
  open: false,
  activeTab: "files",
  threadId: null,
  initialFilePath: null,
  initialFolderPath: null,
  initialLineNumber: null,
  openRequestKey: 0,
  show: (tab, threadId) =>
    set((state) => ({
      open: true,
      activeTab: tab,
      threadId: nextThreadId(state.threadId, threadId),
    })),
  toggle: (tab, threadId) =>
    set((state) => {
      if (state.open && state.activeTab === tab) return { open: false };
      return {
        open: true,
        activeTab: tab,
        threadId: nextThreadId(state.threadId, threadId),
      };
    }),
  showFile: (threadId, path, lineNumber) =>
    set((state) => ({
      open: true,
      activeTab: "files",
      threadId,
      initialFilePath: path,
      initialFolderPath: null,
      initialLineNumber: lineNumber ?? null,
      openRequestKey: state.openRequestKey + 1,
    })),
  showFolder: (threadId, path) =>
    set((state) => ({
      open: true,
      activeTab: "files",
      threadId,
      initialFilePath: null,
      initialFolderPath: path,
      initialLineNumber: null,
      openRequestKey: state.openRequestKey + 1,
    })),
  setActiveTab: (activeTab) => set({ activeTab, open: true }),
  setThreadId: (threadId) =>
    set((state) =>
      state.threadId === threadId
        ? {}
        : {
            threadId,
            initialFilePath: null,
            initialFolderPath: null,
            initialLineNumber: null,
          },
    ),
  close: () => set({ open: false }),
  reset: () =>
    set({
      open: false,
      activeTab: "files",
      threadId: null,
      initialFilePath: null,
      initialFolderPath: null,
      initialLineNumber: null,
      openRequestKey: 0,
    }),
}));
