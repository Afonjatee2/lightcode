import { dialog, shell, type BrowserWindow } from "electron";
import {
  dbDeleteProject,
  dbDeleteThread,
  dbGetProjects,
  dbGetState,
  dbGetThreadCompletedTurns,
  dbGetThreadRuntimeItems,
  dbGetThreads,
  dbReplaceThreadCompletedTurns,
  dbReplaceThreadRuntimeSnapshot,
  dbReplaceThreadRuntimeItems,
  dbSetState,
  dbSyncAll,
  dbUpsertProject,
  dbUpsertThread,
} from "../db";
import {
  deleteThreadAttachments,
  resolveProjectFsPath,
  saveClipboardImageFile,
  saveHandoffContextFile,
} from "../attachments/localFiles";
import { readSharedSettingsFile, writeSharedSettingsFile } from "../sharedSettingsFile";
import type { AutoUpdaterController } from "../updates/autoUpdater";
import {
  defineMainLocalIpcHandlers,
  type MainLocalIpcHandlerMap,
  type WindowChromePayload,
} from "@/shared/ipc";
import type { LightcodePaths } from "@/shared/lightcodePaths";

interface CreateLocalIpcHandlersOptions {
  getMainWindow(): BrowserWindow | null;
  requireLightcodePaths(): LightcodePaths;
  updatePowerSaveBlocker(): void;
  autoUpdater: AutoUpdaterController;
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function assertSafeExternalUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid external URL");
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`External URL protocol is not allowed: ${parsed.protocol}`);
  }
  return parsed.toString();
}

export function createLocalIpcHandlers(
  options: CreateLocalIpcHandlersOptions,
): MainLocalIpcHandlerMap {
  return defineMainLocalIpcHandlers({
    pickFolder: async (defaultPath) => {
      const result = await dialog.showOpenDialog(options.getMainWindow()!, {
        properties: ["openDirectory"],
        title: "Add Project",
        ...(defaultPath ? { defaultPath } : {}),
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    pickFiles: async (payload) => {
      const result = await dialog.showOpenDialog(options.getMainWindow()!, {
        properties: ["openFile", "multiSelections"],
        title: payload?.title ?? "Add files or photos",
        filters: payload?.filters ?? [{ name: "All Files", extensions: ["*"] }],
      });
      return result.canceled ? null : result.filePaths;
    },
    saveClipboardImage: (payload) =>
      saveClipboardImageFile(options.requireLightcodePaths(), payload),
    saveHandoffContext: (payload) =>
      saveHandoffContextFile(options.requireLightcodePaths(), payload),
    openExternal: async (url) => {
      await shell.openExternal(assertSafeExternalUrl(url));
    },
    focusWindow: () => {
      const win = options.getMainWindow();
      if (!win) return;
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    },
    revealProjectEntry: async (payload) => {
      shell.showItemInFolder(resolveProjectFsPath(payload));
    },
    getSharedSettings: () => readSharedSettingsFile(options.requireLightcodePaths().settingsPath),
    setSharedSettings: (settings) => {
      const settingsPath = options.requireLightcodePaths().settingsPath;
      // Preserve supervisor-only fields (e.g. `agentHookSupport`) so the
      // renderer's persist cycle doesn't clobber the CLI hook plugin cache that
      // the supervisor writes out-of-band.
      const onDisk = readSharedSettingsFile(settingsPath);
      writeSharedSettingsFile(settingsPath, {
        ...settings,
        agentHookSupport: onDisk.agentHookSupport,
      });
      options.updatePowerSaveBlocker();
    },
    setWindowChrome: async (payload: WindowChromePayload) => {
      const mainWindow = options.getMainWindow();
      if (!mainWindow) {
        return;
      }
      if (process.platform === "win32" || process.platform === "linux") {
        mainWindow.setTitleBarOverlay({
          color: payload.backgroundColor,
          symbolColor: payload.symbolColor,
          height: 32,
        });
      }
    },
    dbGetProjects: () => dbGetProjects(),
    dbGetThreads: () => dbGetThreads(),
    dbGetState: (key) => dbGetState(key),
    dbSetState: ({ key, value }) => dbSetState(key, value),
    dbUpsertProject: (project) => dbUpsertProject(project, 0),
    dbUpsertThread: (thread) => dbUpsertThread(thread, 0),
    dbDeleteThread: ({ threadId }) => {
      dbDeleteThread(threadId);
      deleteThreadAttachments(options.requireLightcodePaths(), threadId);
    },
    dbDeleteProject: ({ projectId }) => dbDeleteProject(projectId),
    dbSyncAll: ({ projects, threads, viewJson }) => dbSyncAll(projects, threads, viewJson),
    dbGetThreadRuntimeItems: ({ threadId }) => dbGetThreadRuntimeItems(threadId),
    dbReplaceThreadRuntimeItems: ({ threadId, items }) =>
      dbReplaceThreadRuntimeItems(threadId, items),
    dbGetThreadCompletedTurns: ({ threadId }) => dbGetThreadCompletedTurns(threadId),
    dbReplaceThreadCompletedTurns: ({ threadId, turns }) =>
      dbReplaceThreadCompletedTurns(threadId, turns),
    dbReplaceThreadRuntimeSnapshot: ({ threadId, items, turns }) =>
      dbReplaceThreadRuntimeSnapshot(threadId, items, turns),
    checkForUpdate: () => options.autoUpdater.checkForUpdate(),
    startUpdateDownload: () => options.autoUpdater.startUpdateDownload(),
    installUpdate: () => options.autoUpdater.installUpdate(),
  });
}
