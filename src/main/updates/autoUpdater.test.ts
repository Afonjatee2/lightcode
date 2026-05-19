import { describe, expect, it, vi } from "vitest";

const autoUpdaterMock = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: true,
  forceDevUpdateConfig: false,
  allowPrerelease: false,
  channel: "",
  checkForUpdates: vi.fn<() => Promise<void>>(),
  downloadUpdate: vi.fn<() => Promise<void>>(),
  on: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(),
  quitAndInstall: vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>(),
  setFeedURL: vi.fn<(options: unknown) => void>(),
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import { createAutoUpdaterController } from "./autoUpdater";

describe("createAutoUpdaterController", () => {
  it("runs the install hook before quitAndInstall", () => {
    const beforeInstall = vi.fn<() => void>();
    const controller = createAutoUpdaterController(
      vi.fn(),
      "stable",
      false,
      vi.fn(),
      beforeInstall,
    );

    controller.installUpdate();

    expect(beforeInstall.mock.invocationCallOrder[0]!).toBeLessThan(
      autoUpdaterMock.quitAndInstall.mock.invocationCallOrder[0]!,
    );
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(process.platform === "win32", true);
  });
});
