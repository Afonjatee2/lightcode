import { describe, expect, it } from "vitest";
import { controlCentreCampaignGroupListFixture } from "@/shared/contracts/campaign/fixtures/controlCentreCampaignGroupList.fixture";
import { controlCentreCampaignGroupListSchema } from "@/shared/contracts/campaign/controlCentreCampaignGroupList";

describe("controlCentreCampaignGroupListSchema", () => {
  it("parses a raw array payload", () => {
    const parsed = controlCentreCampaignGroupListSchema.parse(
      controlCentreCampaignGroupListFixture,
    );
    expect(parsed).toHaveLength(controlCentreCampaignGroupListFixture.length);
    expect(parsed[0]?.id).toBe("cg-live-001");
  });

  it("parses a groups envelope", () => {
    const parsed = controlCentreCampaignGroupListSchema.parse({
      groups: controlCentreCampaignGroupListFixture,
    });
    expect(parsed).toHaveLength(controlCentreCampaignGroupListFixture.length);
  });
});
