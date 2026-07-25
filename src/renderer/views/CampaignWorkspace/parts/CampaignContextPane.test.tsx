import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { CampaignContextViewModel } from "@/renderer/adapters/campaignViewModels";
import { CampaignContextPane } from "./CampaignContextPane";

const baseContext: CampaignContextViewModel = {
  identity: {
    campaignGroupId: "cg-1",
    campaignName: "Test Campaign",
    clientName: "Acme Corp",
    jobNumber: "JOB-123",
    lifecycleStatus: "live",
  },
  dates: {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  },
  budget: {
    currency: "GBP",
    totalBudget: 10000,
    spentToDate: 5000,
    remaining: 5000,
    pctUsed: 50,
  },
  pacing: {
    status: "on_track",
    variancePct: 0,
    note: undefined,
  },
  kpis: [],
  channels: [],
  sourceHealth: [],
  openAlerts: [],
  activeDecisions: [],
  pendingProposals: [],
  recentEvents: [],
  evidenceFreshness: "fresh",
  missingDataWarnings: [],
  generatedAt: undefined,
  suggestedQuestions: [],
};

describe("CampaignContextPane", () => {
  it("renders grouped alerts with a count chip when duplicate alerts exist", () => {
    const context: CampaignContextViewModel = {
      ...baseContext,
      openAlerts: [
        {
          id: "1",
          title: "Instagram attribution gap",
          severity: "warning",
          priority: "P2",
          openedAt: "2026-07-20T10:00:00Z",
        },
        {
          id: "2",
          title: "Instagram attribution gap",
          severity: "warning",
          priority: "P2",
          openedAt: "2026-07-21T10:00:00Z",
        },
        {
          id: "3",
          title: "Instagram attribution gap",
          severity: "warning",
          priority: "P2",
          openedAt: "2026-07-22T10:00:00Z",
        },
      ],
    };

    render(
      <CampaignContextPane
        campaignContext={{ status: "ready", data: context, refetch: vi.fn<() => void>() }}
      />,
    );

    expect(screen.getByText("Instagram attribution gap")).toBeTruthy();
    expect(screen.getByText("×3")).toBeTruthy();
    // Header retains true total count
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("shows only first 3 alert groups by default and reveals remaining groups upon clicking 'Show all'", () => {
    const context: CampaignContextViewModel = {
      ...baseContext,
      openAlerts: [
        {
          id: "1",
          title: "Alert 1",
          severity: "critical",
          priority: "P1",
          openedAt: "2026-07-20T10:00:00Z",
        },
        {
          id: "2",
          title: "Alert 2",
          severity: "warning",
          priority: "P2",
          openedAt: "2026-07-20T10:00:00Z",
        },
        {
          id: "3",
          title: "Alert 3",
          severity: "info",
          priority: "P3",
          openedAt: "2026-07-20T10:00:00Z",
        },
        {
          id: "4",
          title: "Alert 4",
          severity: "info",
          priority: "P4",
          openedAt: "2026-07-20T10:00:00Z",
        },
      ],
    };

    render(
      <CampaignContextPane
        campaignContext={{ status: "ready", data: context, refetch: vi.fn<() => void>() }}
      />,
    );

    expect(screen.getByText("Alert 1")).toBeTruthy();
    expect(screen.getByText("Alert 2")).toBeTruthy();
    expect(screen.getByText("Alert 3")).toBeTruthy();
    expect(screen.queryByText("Alert 4")).toBeNull();

    const showAllBtn = screen.getByRole("button", { name: "Show all" });
    fireEvent.click(showAllBtn);

    expect(screen.getByText("Alert 4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("renders KPI channel label when channel context is present on KPI items", () => {
    const context: CampaignContextViewModel = {
      ...baseContext,
      kpis: [
        {
          id: "k1",
          metricKey: "impressions",
          label: "impressions",
          targetType: "min",
          targetValue: 1000,
          actualValue: 800,
          pctAchieved: 80,
          status: "on_track",
          channel: "Meta Ads",
        } as any,
        {
          id: "k2",
          metricKey: "impressions",
          label: "impressions",
          targetType: "min",
          targetValue: 2000,
          actualValue: 2200,
          pctAchieved: 110,
          status: "on_track",
          channel: "Google Ads",
        } as any,
      ],
    };

    render(
      <CampaignContextPane
        campaignContext={{ status: "ready", data: context, refetch: vi.fn<() => void>() }}
      />,
    );

    expect(screen.getByText("(Meta Ads)")).toBeTruthy();
    expect(screen.getByText("(Google Ads)")).toBeTruthy();
  });

  it("groups duplicate metric names under a single subheading when channel context is absent", () => {
    const context: CampaignContextViewModel = {
      ...baseContext,
      kpis: [
        {
          id: "k1",
          metricKey: "impressions",
          label: "impressions",
          targetType: "min",
          targetValue: 1000,
          actualValue: 800,
          pctAchieved: 80,
          status: "on_track",
        },
        {
          id: "k2",
          metricKey: "impressions",
          label: "impressions",
          targetType: "min",
          targetValue: 2000,
          actualValue: 2200,
          pctAchieved: 110,
          status: "on_track",
        },
        {
          id: "k3",
          metricKey: "cost",
          label: "cost",
          targetType: "max",
          targetValue: 500,
          actualValue: 400,
          pctAchieved: 80,
          status: "on_track",
        },
      ],
    };

    render(
      <CampaignContextPane
        campaignContext={{ status: "ready", data: context, refetch: vi.fn<() => void>() }}
      />,
    );

    expect(screen.getByText("impressions")).toBeTruthy();
    expect(screen.getByText("Target: 1000")).toBeTruthy();
    expect(screen.getByText("Target: 2000")).toBeTruthy();
    expect(screen.getAllByText("80%")).toHaveLength(2);
    expect(screen.getByText("110%")).toBeTruthy();
  });
});
