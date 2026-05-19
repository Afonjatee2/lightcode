import { autoUpdater } from "electron-updater";
import type { LightcodeChannel } from "@/shared/channel";
import type { UpdateStatus } from "@/shared/ipc";
import type { LightcodeDiagnosticTags } from "@/shared/diagnostics/sentryPrivacy";

export interface AutoUpdaterController {
  initialize(): void;
  checkForUpdate(): Promise<void>;
  startUpdateDownload(): Promise<void>;
  installUpdate(): void;
}

export function createAutoUpdaterController(
  sendStatus: (status: UpdateStatus) => void,
  channel: LightcodeChannel,
  isDev: boolean,
  reportError: (error: unknown, tags?: LightcodeDiagnosticTags) => void = () => {},
  beforeInstall: () => void = () => {},
): AutoUpdaterController {
  let initialized = false;

  function initialize(): void {
    if (initialized) {
      return;
    }
    initialized = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.forceDevUpdateConfig = Boolean(process.env.UPDATE_SERVER_URL);

    if (channel === "nightly") {
      autoUpdater.channel = "nightly";
      autoUpdater.allowPrerelease = true;
    } else {
      autoUpdater.allowPrerelease = false;
    }

    const localUpdateUrl = process.env.UPDATE_SERVER_URL;
    if (localUpdateUrl) {
      autoUpdater.setFeedURL({ provider: "generic", url: localUpdateUrl });
    }

    autoUpdater.on("checking-for-update", () => {
      sendStatus({ type: "checking" });
    });
    autoUpdater.on("update-available", (info) => {
      sendStatus({ type: "update-available", version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      sendStatus({ type: "update-not-available" });
    });
    autoUpdater.on("download-progress", (progress) => {
      sendStatus({
        type: "downloading",
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      sendStatus({ type: "downloaded", version: info.version });
    });
    autoUpdater.on("error", (error) => {
      reportError(error, { "lightcode.feature_area": "updates" });
      sendStatus({ type: "error", message: error.message });
    });

    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch((error: unknown) => {
        reportError(error, { "lightcode.feature_area": "updates" });
      });
    }, 3000);
  }

  async function checkForUpdate(): Promise<void> {
    if (isDev && !process.env.UPDATE_SERVER_URL) {
      sendStatus({ type: "error", message: "Update check is not available in dev mode." });
      return;
    }
    await autoUpdater.checkForUpdates();
  }

  async function startUpdateDownload(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EPIPE") {
        return;
      }
      reportError(error, { "lightcode.feature_area": "updates" });
      throw error;
    }
  }

  function installUpdate(): void {
    beforeInstall();
    autoUpdater.quitAndInstall(process.platform === "win32", true);
  }

  return {
    initialize,
    checkForUpdate,
    startUpdateDownload,
    installUpdate,
  };
}
