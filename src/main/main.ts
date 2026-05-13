import { watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, powerSaveBlocker } from "electron";
import { closeDatabase, dbGetThreads, initDatabase } from "./db";
import { cleanupOrphanedAttachments, prepareLightcodeDataRoot } from "./lightcodeData";
import { createLocalIpcHandlers } from "./ipc/localHandlers";
import { registerIpcHandlers } from "./ipc/registerHandlers";
import {
  installLocalFileProtocolHandler,
  registerLocalFileProtocolScheme,
} from "./attachments/localFiles";
import { SupervisorClient } from "./supervisor/SupervisorClient";
import { createAutoUpdaterController } from "./updates/autoUpdater";
import { createMainWindow } from "./window/createMainWindow";
import type { SupervisorEvent } from "@/shared/ipc";
import type { LightcodePaths } from "@/shared/lightcodePaths";
import { getAppName } from "@/shared/appName";
import { IPC_EVENT_CHANNELS } from "@/shared/ipc";
import { readSharedSettingsFile } from "./sharedSettingsFile";
import { WindowsJobObjectManager } from "./windowsJobObject";
import { captureMainException, initializeMainSentry } from "./diagnostics/sentry";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

if (isDev) {
  app.setPath("userData", join(app.getPath("userData"), "Dev"));
}

const sentryEnabled = initializeMainSentry({ appVersion: app.getVersion(), isDev });
const posthogEnabled = process.env.POSTHOG_ENABLED !== "0";
const posthogKey = posthogEnabled ? (process.env.POSTHOG_KEY ?? "").trim() : "";
const posthogHost = (process.env.POSTHOG_HOST ?? "").trim();
const posthogEnableDev = process.env.POSTHOG_ENABLE_DEV === "1";

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
const WINDOW_CHROME_HEIGHT = 32;

let mainWindow: BrowserWindow | null = null;
let lightcodePaths: LightcodePaths | null = null;
let windowsJobObjectManager: WindowsJobObjectManager | null = null;

const workingThreads = new Set<string>();
let powerSaveBlockerId: number | null = null;

function requireLightcodePaths(): LightcodePaths {
  if (!lightcodePaths) {
    throw new Error("Lightcode paths are not initialized.");
  }
  return lightcodePaths;
}

function updatePowerSaveBlocker(): void {
  const enabled = lightcodePaths
    ? (readSharedSettingsFile(lightcodePaths.settingsPath).preventSleepWhileWorking ?? true)
    : true;
  const shouldBlock = enabled && workingThreads.size > 0;
  if (shouldBlock && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!shouldBlock && powerSaveBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
    powerSaveBlockerId = null;
  }
}

function handleSupervisorEventForSleep(event: SupervisorEvent): void {
  if (event.type === "thread-state") {
    const active = event.status === "working" || event.status === "launching";
    if (active) {
      workingThreads.add(event.threadId);
    } else {
      workingThreads.delete(event.threadId);
    }
    updatePowerSaveBlocker();
    return;
  }
  if (event.type === "thread-exited") {
    workingThreads.delete(event.threadId);
    updatePowerSaveBlocker();
  }
}

registerLocalFileProtocolScheme();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    installLocalFileProtocolHandler();

    lightcodePaths = prepareLightcodeDataRoot(
      isDev ? join(homedir(), ".lightcode-dev") : undefined,
    );
    let jobObjectReady: Promise<void> = Promise.resolve();
    if (process.platform === "win32") {
      const manager = new WindowsJobObjectManager();
      windowsJobObjectManager = manager;
      jobObjectReady = manager.start().catch((error) => {
        console.error(
          "[lightcode] Windows Job Object helper unavailable:",
          error instanceof Error ? error.message : String(error),
        );
        captureMainException(error, { "lightcode.feature_area": "process-lifecycle" });
        if (windowsJobObjectManager === manager) {
          windowsJobObjectManager = null;
        }
      });
    }

    initDatabase(lightcodePaths.dbPath);

    const supervisorPath = join(__dirname, "supervisor.cjs");
    const wslHelpersDir = app.isPackaged
      ? join(process.resourcesPath, "wsl-helpers")
      : join(__dirname, "..", "..", "resources", "wsl-helpers");

    const supervisorClient = new SupervisorClient({
      appVersion: app.getVersion(),
      isDev,
      supervisorPath,
      wslHelpersDir,
      assignPid: async (pid) => {
        await windowsJobObjectManager?.assignPid(pid);
      },
      reportError: (error, tags) => {
        captureMainException(error, tags);
      },
      onEvent: (event) => {
        handleSupervisorEventForSleep(event);
        mainWindow?.webContents.send(IPC_EVENT_CHANNELS.supervisorEvent, event);
      },
      onReset: () => {
        workingThreads.clear();
        updatePowerSaveBlocker();
      },
    });

    const autoUpdaterController = createAutoUpdaterController(
      (status) => {
        mainWindow?.webContents.send(IPC_EVENT_CHANNELS.updateStatus, status);
      },
      isDev,
      captureMainException,
    );

    registerIpcHandlers({
      localHandlers: createLocalIpcHandlers({
        getMainWindow: () => mainWindow,
        requireLightcodePaths,
        updatePowerSaveBlocker,
        autoUpdater: autoUpdaterController,
      }),
      callSupervisor: (name, payload) => supervisorClient.call(name, payload),
    });

    mainWindow = createMainWindow({
      title: getAppName(isDev),
      isDev,
      preloadPath: join(__dirname, "preload.cjs"),
      rendererHtmlPath: join(__dirname, "../renderer/index.html"),
      appVersion: app.getVersion(),
      posthogEnableDev,
      posthogEnabled,
      posthogHost,
      posthogKey,
      sentryEnabled,
      windowChromeHeight: WINDOW_CHROME_HEIGHT,
      ...(process.env.VITE_DEV_SERVER_URL ? { devServerUrl: process.env.VITE_DEV_SERVER_URL } : {}),
      onClosed: () => {
        mainWindow = null;
      },
      onRendererProcessGone: (details) => {
        captureMainException(new Error(`Renderer process gone: ${details.reason}`), {
          "lightcode.feature_area": "renderer",
          "lightcode.process": "renderer",
        });
      },
    });

    await jobObjectReady;

    const hookDebugOn =
      Boolean(process.env.LIGHTCODE_HOOK_DEBUG) && process.env.LIGHTCODE_HOOK_DEBUG !== "0";
    if (hookDebugOn) {
      console.log(
        "[lightcode] LIGHTCODE_HOOK_DEBUG is on — watch for [supervisor] hook-debug lines (HookIngress, WSL bridge, L1/L2 spawn, envelopes).",
      );
    }

    supervisorClient.start(lightcodePaths.baseDir);

    mainWindow.once("ready-to-show", () => {
      setTimeout(() => {
        const paths = requireLightcodePaths();
        cleanupOrphanedAttachments(
          paths.attachmentsDir,
          dbGetThreads().map((thread) => thread.id),
        );
      }, 0);
    });

    if (!isDev) {
      autoUpdaterController.initialize();
    }

    if (isDev) {
      let debounce: ReturnType<typeof setTimeout> | null = null;
      watch(supervisorPath, () => {
        if (debounce) {
          clearTimeout(debounce);
        }
        debounce = setTimeout(() => {
          console.log("[lightcode] supervisor changed, restarting…");
          supervisorClient.start(requireLightcodePaths().baseDir);
        }, 200);
      });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow({
          title: getAppName(isDev),
          isDev,
          preloadPath: join(__dirname, "preload.cjs"),
          rendererHtmlPath: join(__dirname, "../renderer/index.html"),
          appVersion: app.getVersion(),
          posthogEnableDev,
          posthogEnabled,
          posthogHost,
          posthogKey,
          sentryEnabled,
          windowChromeHeight: WINDOW_CHROME_HEIGHT,
          ...(process.env.VITE_DEV_SERVER_URL
            ? { devServerUrl: process.env.VITE_DEV_SERVER_URL }
            : {}),
          onClosed: () => {
            mainWindow = null;
          },
          onRendererProcessGone: (details) => {
            captureMainException(new Error(`Renderer process gone: ${details.reason}`), {
              "lightcode.feature_area": "renderer",
              "lightcode.process": "renderer",
            });
          },
        });
      }
    });

    app.on("before-quit", () => {
      supervisorClient.dispose();
      windowsJobObjectManager?.dispose();
      windowsJobObjectManager = null;
    });
  });
}

app.on("will-quit", () => {
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
