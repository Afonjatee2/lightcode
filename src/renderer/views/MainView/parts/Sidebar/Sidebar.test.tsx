import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { Sidebar } from "./Sidebar";

vi.mock("@/renderer/views/MainView/parts/AppShell/AppShell", () => ({
  useSidebar: () => ({
    isCollapsed: false,
    collapse: () => undefined,
    expand: () => undefined,
  }),
}));

vi.mock("@/renderer/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/bridge")>();
  return {
    ...actual,
    readBridge: () => ({
      channel: "stable",
      platform: "darwin",
      getRemoteAccessPairing: async () => ({ status: "off" }),
      installUpdate: async () => undefined,
    }),
  };
});

vi.mock("@/renderer/components/providers/ProviderUsageRail", () => ({
  ProviderUsageRail: () => null,
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/WhatsNewButton", () => ({
  WhatsNewButton: () => null,
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/SidebarProjectSection", () => ({
  SidebarProjectSection: () => null,
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/SidebarCampaignsSection", () => ({
  SidebarCampaignsSection: (props: { campaignProjectIds: readonly string[] }) =>
    props.campaignProjectIds.length > 0 ? <div data-testid="sidebar-campaigns-section" /> : null,
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/SidebarRemoteServers", () => ({
  SidebarRemoteServers: () => null,
}));

vi.mock("@/renderer/views/MainView/parts/Sidebar/parts/SidebarProjectThreadList", () => ({
  SidebarProjectThreadList: () => null,
}));

vi.mock("@/renderer/deferredFeatures", () => ({
  DeferredSettingsOverlay: { preload: () => undefined },
}));

vi.mock("@/renderer/state/remoteServersStore", () => ({
  useRemoteServersStore: {
    getState: () => ({ connectAll: async () => undefined }),
  },
}));

vi.mock("@/renderer/state/updateStore", () => ({
  useUpdateStore: (selector: (state: { phase: string }) => unknown) => selector({ phase: "idle" }),
}));

function codeProject(): Project {
  return {
    id: "code-1",
    name: "App",
    location: { kind: "posix", path: "/repo/app" },
    createdAt: "2026-01-01T00:00:00.000Z",
    purpose: "code",
  };
}

function campaignProject(): Project {
  return {
    id: "camp-1",
    name: "Client Campaign",
    location: { kind: "posix", path: "/repo/campaign" },
    createdAt: "2026-01-01T00:00:00.000Z",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: "group-1",
      clientName: "Client",
      campaignName: "Spring",
    },
  };
}

describe("Sidebar campaigns entry", () => {
  beforeEach(() => {
    Object.assign(window, {
      poracode: {
        channel: "stable",
        platform: "darwin",
        getRemoteAccessPairing: async () => ({ status: "off" }),
        installUpdate: async () => undefined,
        dbSyncAll: async () => undefined,
      },
    });
    useAppStore.setState((state) => ({
      ...state,
      projects: [codeProject()],
      view: { kind: "home" },
    }));
    usePanelStore.setState((state) => ({
      ...state,
      settingsOpen: false,
      threadSearchOpen: false,
    }));
    useSharedSettings.setState({
      homeScopeEnabled: false,
      remoteAccessEnabled: false,
    });
  });

  it("shows a permanent Campaigns footer entry with zero campaign projects", () => {
    render(<Sidebar />);

    expect(screen.getByRole("button", { name: "Campaigns" })).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-campaigns-section")).not.toBeInTheDocument();
  });

  it("routes the Campaigns footer entry to campaign Today", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Campaigns" }));

    expect(useAppStore.getState().view).toEqual({ kind: "campaignToday" });
  });

  it("keeps the campaigns project section when campaign projects exist", () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [codeProject(), campaignProject()],
    }));

    render(<Sidebar />);

    expect(screen.getByRole("button", { name: "Campaigns" })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-campaigns-section")).toBeInTheDocument();
  });

  it("highlights Campaigns when campaign Today is active", () => {
    useAppStore.setState((state) => ({
      ...state,
      view: { kind: "campaignToday" },
    }));

    render(<Sidebar />);

    const campaignsButton = screen.getByRole("button", { name: "Campaigns" });
    expect(campaignsButton.className).toContain("bg-[var(--row-active)]");
  });
});
