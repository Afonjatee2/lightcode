import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteAccessTailscaleStatus } from "@/shared/ipc";
import type { RemoteAccessPairingInfo } from "@/shared/remote";
import { RemoteAccessSettings } from "./RemoteAccessSettings";

const { bridgeMock, sharedSettingsState, toDataURLMock } = vi.hoisted(() => ({
  bridgeMock: {
    getRemoteAccessPairing: vi.fn<() => Promise<RemoteAccessPairingInfo>>(),
    getRemoteAccessTailscaleStatus: vi.fn<() => Promise<RemoteAccessTailscaleStatus>>(),
    openExternal: vi.fn<(url: string) => Promise<void>>(),
  },
  sharedSettingsState: {
    remoteAccessTailscaleHttps: true,
    remoteAccessAdvertisedUrl: "",
    remotePushEnabled: true,
    setRemotePushEnabled: vi.fn<(enabled: boolean) => void>(),
    remotePushRedactContent: false,
    setRemotePushRedactContent: vi.fn<(redact: boolean) => void>(),
  },
  toDataURLMock: vi.fn<(value: string, options: unknown) => Promise<string>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridgeMock,
}));

vi.mock("@/renderer/state/sharedSettingsStore", () => ({
  useSharedSettings: (selector: (state: typeof sharedSettingsState) => unknown) =>
    selector(sharedSettingsState),
}));

vi.mock("qrcode", () => ({
  toDataURL: toDataURLMock,
}));

describe("RemoteAccessSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMock.getRemoteAccessPairing.mockResolvedValue({
      status: "ready",
      httpBaseUrl: "https://desktop.tailnet.ts.net/",
      localHttpBaseUrl: "http://192.168.1.20:49152",
      tailscaleHttpBaseUrl: "https://desktop.tailnet.ts.net",
      wsBaseUrl: "wss://desktop.tailnet.ts.net/",
      pairingUrl:
        "https://poracode.com/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%2F#token=lc_pair_test",
      sessions: [],
    });
    bridgeMock.getRemoteAccessTailscaleStatus.mockResolvedValue({
      enabled: true,
      daemon: "running",
      serveActive: true,
      httpsUrl: "https://desktop.tailnet.ts.net",
    });
    toDataURLMock.mockResolvedValue("data:image/png;base64,test");
  });

  it("switches the displayed endpoint and QR code from Tailscale to local", async () => {
    render(<RemoteAccessSettings />);

    expect(await screen.findByText("https://desktop.tailnet.ts.net")).toBeInTheDocument();
    await waitFor(() => {
      expect(toDataURLMock).toHaveBeenCalledWith(
        "https://poracode.com/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net#token=lc_pair_test",
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole("radio", { name: "Local" }));

    expect(await screen.findByText("http://192.168.1.20:49152")).toBeInTheDocument();
    await waitFor(() => {
      expect(toDataURLMock).toHaveBeenCalledWith(
        "https://poracode.com/pair?host=http%3A%2F%2F192.168.1.20%3A49152#token=lc_pair_test",
        expect.any(Object),
      );
    });
  });
});
