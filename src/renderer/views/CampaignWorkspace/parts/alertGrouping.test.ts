import { describe, expect, it } from "vitest";
import type { CampaignContextAlertViewModel } from "@/renderer/adapters/campaignViewModels";
import { groupAlerts } from "./alertGrouping";

describe("groupAlerts", () => {
  it("collapses duplicate alerts by title and severity into groups with correct counts", () => {
    const alerts: CampaignContextAlertViewModel[] = [
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
    ];

    const result = groupAlerts(alerts);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      key: "warning:Instagram attribution gap",
      title: "Instagram attribution gap",
      severity: "warning",
      priority: "P2",
      count: 3,
      instances: alerts,
    });
  });

  it("leaves singletons untouched with count 1", () => {
    const alerts: CampaignContextAlertViewModel[] = [
      {
        id: "1",
        title: "GA4 sync delayed",
        severity: "info",
        priority: "P4",
        openedAt: "2026-07-20T10:00:00Z",
      },
    ];

    const result = groupAlerts(alerts);
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(1);
    expect(result[0]!.instances).toHaveLength(1);
    expect(result[0]!.instances[0]).toEqual(alerts[0]);
  });

  it("sorts by severity first, then count desc", () => {
    const alerts: CampaignContextAlertViewModel[] = [
      {
        id: "a1",
        title: "Minor warning A",
        severity: "warning",
        priority: "P2",
        openedAt: "2026-07-20T10:00:00Z",
      },
      {
        id: "a2",
        title: "Minor warning A",
        severity: "warning",
        priority: "P2",
        openedAt: "2026-07-20T11:00:00Z",
      },
      {
        id: "b1",
        title: "Major warning B",
        severity: "warning",
        priority: "P2",
        openedAt: "2026-07-20T10:00:00Z",
      },
      {
        id: "b2",
        title: "Major warning B",
        severity: "warning",
        priority: "P2",
        openedAt: "2026-07-20T11:00:00Z",
      },
      {
        id: "b3",
        title: "Major warning B",
        severity: "warning",
        priority: "P2",
        openedAt: "2026-07-20T12:00:00Z",
      },
      {
        id: "c1",
        title: "Critical issue C",
        severity: "critical",
        priority: "P1",
        openedAt: "2026-07-20T10:00:00Z",
      },
    ];

    const result = groupAlerts(alerts);
    expect(result).toHaveLength(3);

    // 1st: Critical issue C (severity critical)
    expect(result[0]!.title).toBe("Critical issue C");
    expect(result[0]!.count).toBe(1);

    // 2nd: Major warning B (severity warning, count 3)
    expect(result[1]!.title).toBe("Major warning B");
    expect(result[1]!.count).toBe(3);

    // 3rd: Minor warning A (severity warning, count 2)
    expect(result[2]!.title).toBe("Minor warning A");
    expect(result[2]!.count).toBe(2);
  });

  it("preserves instances for row expansion", () => {
    const alerts: CampaignContextAlertViewModel[] = [
      {
        id: "1",
        title: "Attribution gap",
        severity: "warning",
        priority: "P2",
        openedAt: "2026-07-20T10:00:00Z",
      },
      {
        id: "2",
        title: "Attribution gap",
        severity: "warning",
        priority: "P2",
        openedAt: "2026-07-21T11:00:00Z",
      },
    ];

    const result = groupAlerts(alerts);
    expect(result[0]!.instances).toHaveLength(2);
    expect(result[0]!.instances[0]!.id).toBe("1");
    expect(result[0]!.instances[1]!.id).toBe("2");
  });
});
