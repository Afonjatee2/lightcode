import { describe, expect, it } from "vitest";
import { shouldLandOnCampaignToday } from "./resolveCampaignLanding";

describe("shouldLandOnCampaignToday", () => {
  it("lands a returning campaign operator on the campaign Today home", () => {
    expect(
      shouldLandOnCampaignToday({
        welcomeSeen: true,
        hasCampaignProject: true,
        restoredViewKind: "home",
      }),
    ).toBe(true);
  });

  it("never bypasses a first-run welcome", () => {
    expect(
      shouldLandOnCampaignToday({
        welcomeSeen: false,
        hasCampaignProject: true,
        restoredViewKind: "home",
      }),
    ).toBe(false);
  });

  it("leaves users with no campaign project untouched", () => {
    expect(
      shouldLandOnCampaignToday({
        welcomeSeen: true,
        hasCampaignProject: false,
        restoredViewKind: "home",
      }),
    ).toBe(false);
  });

  it("does not clobber a restored working session", () => {
    for (const restoredViewKind of ["thread", "draft", "experiment", "swarm"] as const) {
      expect(
        shouldLandOnCampaignToday({
          welcomeSeen: true,
          hasCampaignProject: true,
          restoredViewKind,
        }),
      ).toBe(false);
    }
  });

  it("does not redirect when already on the campaign Today home", () => {
    expect(
      shouldLandOnCampaignToday({
        welcomeSeen: true,
        hasCampaignProject: true,
        restoredViewKind: "campaignToday",
      }),
    ).toBe(false);
  });
});
