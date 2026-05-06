import { dialog, shell, type BrowserWindow } from "electron";
import {
  dbDeleteProject,
  dbDeleteThread,
  dbGetProjects,
  dbGetState,
  dbGetThreadRuntimeItems,
  dbGetThreads,
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
      await shell.openExternal(url);
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
    checkForUpdate: () => options.autoUpdater.checkForUpdate(),
    startUpdateDownload: () => options.autoUpdater.startUpdateDownload(),
    installUpdate: () => options.autoUpdater.installUpdate(),
  });
}
