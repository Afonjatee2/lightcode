import { beforeEach, describe, expect, it, vi } from "vitest";
import { controlCentreOperationsTodayFixture } from "@/shared/contracts/campaign/fixtures/controlCentreOperationsToday.fixture";
import { defaultSharedSettings } from "@/shared/settings";
import { mapOperationsToday } from "@/renderer/adapters/mapOperationsToday";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { generateMorningBrief } from "./briefGenerator";
import { processMorningBriefNotifications } from "./morningBriefSync";
import { readBridge } from "@/renderer/bridge";

vi.mock("@/renderer/bridge", () => ({
  readBridge:
    vi.fn<
      () => { showNotification: (payload: { title: string; body: string }) => Promise<boolean> }
    >(),
}));

describe("morningBriefSync and opt-in default", () => {
  const showNotificationMock = vi
    .fn<(payload: { title: string; body: string }) => Promise<boolean>>()
    .mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    (readBridge as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      showNotification: showNotificationMock,
    });

    useSharedSettings.setState({
      morningBriefEnabled: false,
      morningBriefTime: "08:00",
      morningBriefScheduleId: null,
      morningBriefNotifiedKeys: [],
      notificationsEnabled: true,
    });
  });

  it("verifies opt-in default is off", () => {
    expect(defaultSharedSettings.morningBriefEnabled).toBe(false);
    expect(useSharedSettings.getState().morningBriefEnabled).toBe(false);
  });

  it("does not send notifications when morningBriefEnabled is off", () => {
    const mapped = mapOperationsToday(controlCentreOperationsTodayFixture);
    const brief = generateMorningBrief(mapped);

    processMorningBriefNotifications(brief);

    expect(showNotificationMock).not.toHaveBeenCalled();
  });

  it("sends notifications for new exceptions when enabled and deduplicates repeat runs", () => {
    useSharedSettings.setState({ morningBriefEnabled: true });

    const mapped = mapOperationsToday(controlCentreOperationsTodayFixture);
    const brief = generateMorningBrief(mapped);

    expect(brief.exceptions.length).toBeGreaterThan(0);

    processMorningBriefNotifications(brief);

    expect(showNotificationMock).toHaveBeenCalledTimes(brief.exceptions.length);
    const notifiedKeys = useSharedSettings.getState().morningBriefNotifiedKeys;
    expect(notifiedKeys.length).toBe(brief.exceptions.length);

    // Second processing of the exact same brief
    showNotificationMock.mockClear();
    processMorningBriefNotifications(brief);

    // Should NOT notify again because all items are deduplicated
    expect(showNotificationMock).not.toHaveBeenCalled();
  });

  it("sends zero notifications when brief has no exceptions (all clear)", () => {
    useSharedSettings.setState({ morningBriefEnabled: true });

    const allClearMapped = mapOperationsToday({
      generatedAt: "2026-11-20T18:00:00.000Z",
      needsAttention: [],
      waitingForApproval: [],
      otherLive: [],
      healthyCampaignCount: 2,
      sourceHealthSummary: { healthy: 2, stale: 0, failed: 0 },
      recentlyResolved: [],
    });

    const brief = generateMorningBrief(allClearMapped);
    expect(brief.hasExceptions).toBe(false);

    processMorningBriefNotifications(brief);

    expect(showNotificationMock).not.toHaveBeenCalled();
  });
});
