import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the bridge before importing any components that read from it
const bridge = vi.hoisted(() => ({
  platform: "darwin",
  windowKind: "main",
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
  isRemoteSession: () => false,
}));

import type { Project, McpServer } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { McpSection } from "./McpSection";

function seedProject(overrides: Partial<Project> = {}) {
  useAppStore.setState((state) => ({
    ...state,
    projects: [
      {
        id: "project-1",
        name: "Campaign Project",
        purpose: "campaign",
        location: { kind: "posix", path: "/repo" },
        createdAt: "2026-06-10T00:00:00.000Z",
        campaignExtension: {
          mcpProfile: "monitoring",
          campaignGroupId: "cg-1",
          clientName: "Bright Horizon Group",
          campaignName: "Q4 Brand Refresh",
        },
        ...overrides,
      },
    ],
  }));
}

describe("McpSection - Control Centre Profile Wording & State", () => {
  beforeEach(() => {
    useSharedSettings.setState({ mcpServers: [] });
  });

  it("renders the profile selector enabled for stdio server", () => {
    const stdioCC: McpServer = {
      id: "cc-1",
      name: "control-centre",
      description: "",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio", command: "cc-mcp", args: [], env: {} },
    };
    seedProject({ mcpServers: [stdioCC] });

    render(<McpSection projectId="project-1" />);

    // Selector should be enabled
    const select = screen.getByLabelText("Control Centre MCP Profile");
    expect(select).not.toBeDisabled();

    // Wording check
    const description = screen.getByText(
      /exposes for this campaign project. Changes apply when Tee's Cockpit next starts/,
    );
    expect(description).toBeInTheDocument();
  });

  it("renders the profile selector disabled for remote HTTP/SSE server", () => {
    const remoteCC: McpServer = {
      id: "cc-1",
      name: "control-centre",
      description: "",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "http", url: "https://cc.example.com", headers: {} },
    };
    seedProject({ mcpServers: [remoteCC] });

    render(<McpSection projectId="project-1" />);

    // Selector should be disabled
    const select = screen.getByLabelText("Control Centre MCP Profile");
    expect(select).toBeDisabled();

    // Wording check
    const description = screen.getByText(
      /active remote Control Centre profile is managed by the remote server administrator/,
    );
    expect(description).toBeInTheDocument();
  });
});
