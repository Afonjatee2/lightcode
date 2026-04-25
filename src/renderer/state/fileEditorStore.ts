import { create } from "zustand";
import type {
  ProjectFileReadStatus,
  ProjectLocation,
  ReadProjectFileResult,
} from "@/shared/contracts";
import { readBridge } from "../bridge";

export type FileEditorOverlayMode = "modal" | "fullscreen";

export interface FileEditorRootContext {
  projectId: string;
  projectName: string;
  projectLocation: ProjectLocation;
  rootLabel: string;
  worktreePath?: string;
}

export interface FileEditorBuffer {
  path: string;
  status: ProjectFileReadStatus;
  modifiedAtMs: number;
  content: string;
  savedContent: string;
  lineEnding: "lf" | "crlf";
  hasBom: boolean;
  isDirty: boolean;
  isLoading: boolean;
}

interface FileEditorStoreState {
  rootContext: FileEditorRootContext | null;
  overlayMode: FileEditorOverlayMode | null;
  tabs: string[];
  activePath: string | null;
  previewTab: string | null;
  buffers: Record<string, FileEditorBuffer>;
  refreshToken: number;
  setRootContext: (context: FileEditorRootContext | null) => void;
  clearSession: () => void;
  openFile: (
    path: string,
    mode?: FileEditorOverlayMode | null,
    preview?: boolean,
  ) => Promise<ReadProjectFileResult>;
  pinTab: (path: string) => void;
  setOverlayMode: (mode: FileEditorOverlayMode | null) => void;
  setActivePath: (path: string | null) => void;
  updateBuffer: (path: string, content: string) => void;
  discardFileChanges: (path: string) => void;
  saveFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  renamePath: (oldPath: string, nextPath: string) => void;
  removePath: (path: string) => void;
  bumpRefreshToken: () => void;
  refreshOpenBuffers: () => Promise<void>;
}

/**
 * Per-path timestamps of the most recent user-initiated save. When the
 * watcher fires a tree-changed event within this window we skip refreshing
 * the buffer — the filesystem change came from us, and any read round-trip
 * would just rebuild Monaco's value (dropping focus and causing a blink).
 * Module-local because this isn't state anything needs to re-render on.
 */
const recentlySavedAt = new Map<string, number>();
const SELF_SAVE_SUPPRESS_MS = 1500;

function isRecentlySavedBySelf(path: string): boolean {
  const at = recentlySavedAt.get(path);
  if (at === undefined) return false;
  if (Date.now() - at > SELF_SAVE_SUPPRESS_MS) {
    recentlySavedAt.delete(path);
    return false;
  }
  return true;
}

function buildBuffer(result: ReadProjectFileResult): FileEditorBuffer {
  if (result.status !== "ready") {
    return {
      path: result.path,
      status: result.status,
      modifiedAtMs: result.modifiedAtMs,
      content: "",
      savedContent: "",
      lineEnding: "lf",
      hasBom: false,
      isDirty: false,
      isLoading: false,
    };
  }

  return {
    path: result.path,
    status: "ready",
    modifiedAtMs: result.modifiedAtMs,
    content: result.content ?? "",
    savedContent: result.content ?? "",
    lineEnding: result.lineEnding ?? "lf",
    hasBom: result.hasBom ?? false,
    isDirty: false,
    isLoading: false,
  };
}

/**
 * Compute the next tabs/buffers/previewTab state when opening a file.
 * Handles replacing the existing preview tab at the same position.
 */
function computeTabOpen(
  state: {
    tabs: string[];
    previewTab: string | null;
    buffers: Record<string, FileEditorBuffer>;
    overlayMode: FileEditorOverlayMode | null;
  },
  path: string,
  mode: FileEditorOverlayMode | null | undefined,
  preview: boolean,
) {
  const isAlreadyOpen = state.tabs.includes(path);
  const isCurrentPreview = state.previewTab === path;

  if (preview) {
    // If already open as a permanent tab, just activate — don't demote it
    if (isAlreadyOpen && !isCurrentPreview) {
      return {
        tabs: state.tabs,
        buffers: state.buffers,
        previewTab: state.previewTab,
        overlayMode: mode ?? state.overlayMode,
      };
    }

    const oldPreview = state.previewTab;
    let tabs = state.tabs;
    let buffers = state.buffers;

    if (oldPreview && oldPreview !== path) {
      // Replace old preview at the same position
      const idx = tabs.indexOf(oldPreview);
      tabs = tabs.filter((t) => t !== oldPreview);
      if (!tabs.includes(path)) {
        tabs = [...tabs.slice(0, idx), path, ...tabs.slice(idx)];
      }
      const { [oldPreview]: _, ...rest } = buffers;
      buffers = rest;
    } else if (!isAlreadyOpen) {
      tabs = [...tabs, path];
    }

    return {
      tabs,
      buffers,
      previewTab: path as string | null,
      overlayMode: mode ?? state.overlayMode,
    };
  }

  // Permanent open
  return {
    tabs: isAlreadyOpen ? state.tabs : [...state.tabs, path],
    buffers: state.buffers,
    previewTab: isCurrentPreview ? null : state.previewTab,
    overlayMode: mode ?? state.overlayMode,
  };
}

export const useFileEditorStore = create<FileEditorStoreState>((set, get) => ({
  rootContext: null,
  overlayMode: null,
  tabs: [],
  activePath: null,
  previewTab: null,
  buffers: {},
  refreshToken: 0,
  setRootContext: (rootContext) =>
    set((state) => {
      if (
        state.rootContext?.projectId === rootContext?.projectId &&
        state.rootContext?.worktreePath === rootContext?.worktreePath
      ) {
        return {};
      }

      return {
        rootContext,
        overlayMode: null,
        tabs: [],
        activePath: null,
        previewTab: null,
        buffers: {},
        refreshToken: state.refreshToken + 1,
      };
    }),
  clearSession: () =>
    set((state) => ({
      rootContext: null,
      overlayMode: null,
      tabs: [],
      activePath: null,
      previewTab: null,
      buffers: {},
      refreshToken: state.refreshToken + 1,
    })),
  async openFile(path, mode = "modal", preview = false) {
    const rootContext = get().rootContext;
    if (!rootContext) {
      throw new Error("No file editor context is active.");
    }

    const existing = get().buffers[path];
    if (existing && !existing.isLoading) {
      set((state) => {
        const changes = computeTabOpen(state, path, mode, preview);
        return { ...changes, activePath: path };
      });
      return {
        path,
        status: existing.status,
        modifiedAtMs: existing.modifiedAtMs,
        ...(existing.status === "ready"
          ? {
              content: existing.content,
              lineEnding: existing.lineEnding,
              hasBom: existing.hasBom,
            }
          : {}),
      };
    }

    set((state) => {
      const changes = computeTabOpen(state, path, mode, preview);
      return {
        ...changes,
        activePath: path,
        buffers: {
          ...changes.buffers,
          [path]: {
            path,
            status: "ready",
            modifiedAtMs: 0,
            content: "",
            savedContent: "",
            lineEnding: "lf",
            hasBom: false,
            isDirty: false,
            isLoading: true,
          },
        },
      };
    });

    try {
      const result = await readBridge().readProjectFile({
        projectLocation: rootContext.projectLocation,
        path,
      });
      set((state) => ({
        buffers: {
          ...state.buffers,
          [path]: buildBuffer(result),
        },
      }));
      return result;
    } catch (error) {
      set((state) => {
        const { [path]: _, ...rest } = state.buffers;
        return {
          buffers: rest,
          tabs: state.tabs.filter((tabPath) => tabPath !== path),
          activePath:
            state.activePath === path
              ? (state.tabs.find((tabPath) => tabPath !== path) ?? null)
              : state.activePath,
          previewTab: state.previewTab === path ? null : state.previewTab,
        };
      });
      throw error;
    }
  },
  pinTab: (path) => set((state) => (state.previewTab === path ? { previewTab: null } : {})),
  setOverlayMode: (overlayMode) => set({ overlayMode }),
  setActivePath: (activePath) => set({ activePath }),
  updateBuffer: (path, content) =>
    set((state) => {
      const buffer = state.buffers[path];
      if (!buffer || buffer.status !== "ready") return {};
      return {
        // Editing a preview tab promotes it to permanent
        previewTab: state.previewTab === path ? null : state.previewTab,
        buffers: {
          ...state.buffers,
          [path]: {
            ...buffer,
            content,
            isDirty: content !== buffer.savedContent,
          },
        },
      };
    }),
  discardFileChanges: (path) =>
    set((state) => {
      const buffer = state.buffers[path];
      if (!buffer || buffer.status !== "ready" || !buffer.isDirty) return {};
      return {
        buffers: {
          ...state.buffers,
          [path]: {
            ...buffer,
            content: buffer.savedContent,
            isDirty: false,
          },
        },
      };
    }),
  async saveFile(path) {
    const rootContext = get().rootContext;
    const buffer = get().buffers[path];
    if (!rootContext || !buffer || buffer.status !== "ready" || !buffer.isDirty) {
      return;
    }

    const result = await readBridge().writeProjectFile({
      projectLocation: rootContext.projectLocation,
      path,
      content: buffer.content,
      baseModifiedAtMs: buffer.modifiedAtMs,
    });

    recentlySavedAt.set(path, Date.now());

    set((state) => {
      const current = state.buffers[path];
      if (!current || current.status !== "ready") return {};
      return {
        buffers: {
          ...state.buffers,
          [path]: {
            ...current,
            modifiedAtMs: result.modifiedAtMs,
            savedContent: current.content,
            isDirty: false,
          },
        },
      };
    });
  },
  closeTab: (path) =>
    set((state) => {
      if (!state.tabs.includes(path)) return {};

      const tabs = state.tabs.filter((tabPath) => tabPath !== path);
      const { [path]: _, ...buffers } = state.buffers;
      const nextActivePath =
        state.activePath === path ? (tabs[tabs.length - 1] ?? null) : state.activePath;

      return {
        tabs,
        buffers,
        activePath: nextActivePath,
        previewTab: state.previewTab === path ? null : state.previewTab,
        overlayMode:
          tabs.length === 0 && state.overlayMode !== "fullscreen" ? null : state.overlayMode,
      };
    }),
  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.tabs.length ||
        toIndex >= state.tabs.length
      )
        return {};
      const tabs = [...state.tabs];
      const moved = tabs.splice(fromIndex, 1)[0];
      if (!moved) return {};
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),
  renamePath: (oldPath, nextPath) =>
    set((state) => {
      const nextBuffers = { ...state.buffers };

      for (const [bufferPath, buffer] of Object.entries(state.buffers)) {
        if (bufferPath !== oldPath && !bufferPath.startsWith(`${oldPath}/`)) {
          continue;
        }
        delete nextBuffers[bufferPath];
        const remappedPath =
          bufferPath === oldPath ? nextPath : `${nextPath}/${bufferPath.slice(oldPath.length + 1)}`;
        nextBuffers[remappedPath] = { ...buffer, path: remappedPath };
      }

      const remapPath = (p: string | null): string | null => {
        if (!p) return p;
        if (p === oldPath) return nextPath;
        if (p.startsWith(`${oldPath}/`)) return `${nextPath}/${p.slice(oldPath.length + 1)}`;
        return p;
      };

      return {
        buffers: nextBuffers,
        tabs: state.tabs.map((tabPath) => remapPath(tabPath)!),
        activePath: remapPath(state.activePath),
        previewTab: remapPath(state.previewTab),
        refreshToken: state.refreshToken + 1,
      };
    }),
  removePath: (path) =>
    set((state) => {
      const tabs = state.tabs.filter(
        (tabPath) => tabPath !== path && !tabPath.startsWith(`${path}/`),
      );
      const buffers = Object.fromEntries(
        Object.entries(state.buffers).filter(
          ([bufferPath]) => bufferPath !== path && !bufferPath.startsWith(`${path}/`),
        ),
      );
      const previewRemoved = state.previewTab === path || state.previewTab?.startsWith(`${path}/`);
      return {
        tabs,
        buffers,
        activePath:
          state.activePath === path || state.activePath?.startsWith(`${path}/`)
            ? (tabs[tabs.length - 1] ?? null)
            : state.activePath,
        previewTab: previewRemoved ? null : state.previewTab,
        overlayMode:
          tabs.length === 0 && state.overlayMode !== "fullscreen" ? null : state.overlayMode,
        refreshToken: state.refreshToken + 1,
      };
    }),
  bumpRefreshToken: () => set((state) => ({ refreshToken: state.refreshToken + 1 })),
  async refreshOpenBuffers() {
    const { rootContext, buffers } = get();
    if (!rootContext) return;

    const paths = Object.entries(buffers)
      .filter(([path, buf]) => {
        if (buf.status !== "ready" || buf.isDirty || buf.isLoading) return false;
        // Filesystem events triggered by our own save round-trip don't need
        // to rebuild the buffer — suppress for a short window so Monaco
        // doesn't lose focus / blink on Ctrl+S.
        if (isRecentlySavedBySelf(path)) return false;
        return true;
      })
      .map(([p]) => p);

    if (paths.length === 0) return;

    const results = await Promise.allSettled(
      paths.map((path) =>
        readBridge()
          .readProjectFile({ projectLocation: rootContext.projectLocation, path })
          .then((result) => ({ path, result })),
      ),
    );

    set((state) => {
      let changed = false;
      const nextBuffers = { ...state.buffers };

      for (const entry of results) {
        if (entry.status !== "fulfilled") continue;
        const { path, result } = entry.value;
        const current = nextBuffers[path];
        // Skip if the buffer was modified by the user while we were reading
        if (!current || current.isDirty || current.status !== "ready") continue;

        // Fast path: on-disk content matches what the editor shows. Refresh
        // mtime/savedContent in-place so the next compare short-circuits,
        // but don't swap the buffer object out from under Monaco — a prop
        // change there drops focus and causes a visible blink.
        if (result.status === "ready" && result.content === current.content) {
          if (
            result.modifiedAtMs !== current.modifiedAtMs ||
            result.content !== current.savedContent
          ) {
            nextBuffers[path] = {
              ...current,
              modifiedAtMs: result.modifiedAtMs,
              savedContent: result.content,
            };
            changed = true;
          }
          continue;
        }

        nextBuffers[path] = buildBuffer(result);
        changed = true;
      }

      return changed ? { buffers: nextBuffers } : {};
    });
  },
}));
