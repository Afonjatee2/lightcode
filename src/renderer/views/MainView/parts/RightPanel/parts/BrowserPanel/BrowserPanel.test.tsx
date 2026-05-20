import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { BrowserPanel } from "./BrowserPanel";

vi.mock("./hooks/useElementPicker", () => ({
  useElementPicker: () => ({
    pickerActive: false,
    startPicker: vi.fn<() => Promise<{ ok: boolean; cancelled: boolean }>>(),
    threadTargets: [],
    pendingPickerAttachment: null,
    chooseTargetForPendingPick: vi.fn<(threadId: string) => void>(),
    cancelPendingPick: vi.fn<() => void>(),
  }),
}));

vi.mock("./parts/BrowserToolbar", () => ({
  BrowserToolbar: () => <div data-testid="browser-toolbar" />,
}));

vi.mock("./parts/BrowserTabStrip", () => ({
  BrowserTabStrip: () => <div data-testid="browser-tab-strip" />,
}));

vi.mock("@/renderer/bridge", () => ({
  isMac: () => false,
  readBridge: () => ({
    browserCreateTab: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    browserAttachWebContents: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}));

describe("BrowserPanel", () => {
  beforeEach(() => {
    useBrowserPanelStore.setState({
      tabs: [],
      activeTabId: null,
      pickerActive: false,
      attentionTabId: null,
    });
    usePanelStore.setState({
      browserOverlayOpen: false,
    });
  });

  it("renders the empty state when there are no tabs", () => {
    const { getByText } = render(<BrowserPanel visible />);
    expect(getByText("No browser tab open")).toBeTruthy();
  });

  it("renders a <webview> per tab and hides inactive ones", () => {
    useBrowserPanelStore.setState({
      tabs: [
        {
          tabId: "tab-1",
          url: "https://example.com/",
          title: "Example",
          loading: false,
          canGoBack: false,
          canGoForward: false,
        },
        {
          tabId: "tab-2",
          url: "https://example.org/",
          title: "Other",
          loading: false,
          canGoBack: false,
          canGoForward: false,
        },
      ],
      activeTabId: "tab-1",
    });
    const { container } = render(<BrowserPanel visible />);
    const webviews = container.querySelectorAll("webview");
    expect(webviews).toHaveLength(2);
    expect((webviews[0] as HTMLElement).style.display).toBe("flex");
    expect((webviews[1] as HTMLElement).style.display).toBe("none");
  });
});
