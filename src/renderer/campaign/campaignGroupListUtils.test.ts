import { describe, expect, it } from "vitest";
import { controlCentreCampaignGroupListFixture } from "@/shared/contracts/campaign/fixtures/controlCentreCampaignGroupList.fixture";
import {
  campaignGroupToExtension,
  filterCampaignGroups,
  sortCampaignGroups,
} from "./campaignGroupListUtils";

describe("campaignGroupListUtils", () => {
  it("sorts live and active groups before others", () => {
    const sorted = sortCampaignGroups(controlCentreCampaignGroupListFixture);
    expect(sorted.slice(0, 3).every((group) => ["live", "active"].includes(group.status))).toBe(
      true,
    );
    expect(sorted.at(-1)?.status).toBe("paused");
  });

  it("filters by job number", () => {
    const filtered = filterCampaignGroups(controlCentreCampaignGroupListFixture, "A55201");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("Q4 Brand Refresh");
  });

  it("derives campaign extension fields from a group record", () => {
    const group = controlCentreCampaignGroupListFixture[0]!;
    expect(campaignGroupToExtension(group)).toEqual({
      campaignGroupId: "cg-live-001",
      clientName: "Bright Horizon Group",
      campaignName: "Q4 Brand Refresh",
      jobNumber: "A55201",
      mcpProfile: "monitoring",
    });
  });
});
