import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const image = { isEmpty: vi.fn<() => boolean>(() => false) };
  return {
    app: {
      isPackaged: true,
      dock: { setIcon: vi.fn<(image: unknown) => void>() },
    },
    image,
    createFromPath: vi.fn<(path: string) => typeof image>(),
  };
});

vi.mock("electron", () => ({
  app: electronMock.app,
  nativeImage: { createFromPath: electronMock.createFromPath },
}));

import { refreshMacDockIcon } from "./macDockIcon";

describe("refreshMacDockIcon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMock.app.isPackaged = true;
    electronMock.image.isEmpty.mockReturnValue(false);
    electronMock.createFromPath.mockReturnValue(electronMock.image);
  });

  it("sets the packaged macOS Dock icon from app resources", () => {
    refreshMacDockIcon("darwin", "/Applications/Poracode.app/Contents/Resources");

    expect(electronMock.createFromPath).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]app-icon\.png$/u),
    );
    expect(electronMock.app.dock.setIcon).toHaveBeenCalledWith(electronMock.image);
  });

  it("does nothing outside packaged macOS apps", () => {
    refreshMacDockIcon("win32", "/resources");
    electronMock.app.isPackaged = false;
    refreshMacDockIcon("darwin", "/resources");

    expect(electronMock.createFromPath).not.toHaveBeenCalled();
    expect(electronMock.app.dock.setIcon).not.toHaveBeenCalled();
  });

  it("does not set an empty image", () => {
    electronMock.image.isEmpty.mockReturnValue(true);

    refreshMacDockIcon("darwin", "/resources");

    expect(electronMock.app.dock.setIcon).not.toHaveBeenCalled();
  });
});
