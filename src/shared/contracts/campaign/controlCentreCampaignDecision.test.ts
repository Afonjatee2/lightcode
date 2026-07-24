import { describe, expect, it } from "vitest";
import {
  controlCentreCampaignDecisionDetailSchema,
  controlCentreCampaignDecisionListSchema,
  recordCampaignDecisionArgsSchema,
} from "./controlCentreCampaignDecision";
import { mapCampaignDecisions } from "@/renderer/adapters/mapCampaignDecisions";

/** A realistic `get_campaign_decisions` payload: one active, one expired, one revoked. */
const listPayload = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    campaignGroupId: "22222222-2222-2222-2222-222222222222",
    title: "Allow TikTok to run up to 30% ahead of pace",
    description: "Launch week was intentionally front-loaded.",
    decisionType: "pacing_exception",
    status: "active",
    effectiveStatus: "active",
    startsAt: "2026-07-15T09:00:00.000Z",
    expiresAt: "2026-07-22T23:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-07-15T09:00:00.000Z",
    updatedAt: "2026-07-15T09:00:00.000Z",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    campaignGroupId: "22222222-2222-2222-2222-222222222222",
    title: "Old spend spike is fine over the weekend",
    description: null,
    decisionType: "pacing_exception",
    // Persisted status can still say "active" while the server resolves it as
    // expired via the window — the client must trust effectiveStatus.
    status: "active",
    effectiveStatus: "expired",
    startsAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2026-06-08T00:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    campaignGroupId: "22222222-2222-2222-2222-222222222222",
    title: "Revoked call",
    description: null,
    decisionType: "pacing_exception",
    status: "revoked",
    effectiveStatus: "revoked",
    startsAt: "2026-06-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: "2026-06-02T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
];

describe("controlCentreCampaignDecision contracts", () => {
  it("parses a realistic get_campaign_decisions list payload", () => {
    const parsed = controlCentreCampaignDecisionListSchema.parse(listPayload);
    expect(parsed).toHaveLength(3);
  });

  it("maps summaries to view models and mirrors effectiveStatus into isActive", () => {
    const models = mapCampaignDecisions(controlCentreCampaignDecisionListSchema.parse(listPayload));
    expect(models.map((m) => m.isActive)).toEqual([true, false, false]);
    // The window survives the mapping so the panel can render it.
    expect(models[0]!.startsAt).toBe("2026-07-15T09:00:00.000Z");
    expect(models[0]!.expiresAt).toBe("2026-07-22T23:00:00.000Z");
    expect(models[1]!.expiresAt).toBe("2026-06-08T00:00:00.000Z");
  });

  it("never re-derives active from timestamps — an expired window with status=active stays inactive", () => {
    const expired = mapCampaignDecisions(
      controlCentreCampaignDecisionListSchema.parse(listPayload),
    )[1]!;
    expect(expired.status).toBe("active");
    expect(expired.effectiveStatus).toBe("expired");
    expect(expired.isActive).toBe(false);
  });

  it("parses the record_campaign_decision response detail", () => {
    const detail = {
      ...listPayload[0],
      scope: { platform: "tiktok" },
      effect: { mode: "allow" },
      reason: "Front-loaded launch",
      createdByUserId: "55555555-5555-5555-5555-555555555555",
      revokedByUserId: null,
    };
    const parsed = controlCentreCampaignDecisionDetailSchema.parse(detail);
    expect(parsed.effect.mode).toBe("allow");
    expect(parsed.scope.platform).toBe("tiktok");
  });

  it("accepts a well-formed record_campaign_decision argument set", () => {
    const args = recordCampaignDecisionArgsSchema.parse({
      campaignGroupId: "22222222-2222-2222-2222-222222222222",
      title: "Allow TikTok to run up to 30% ahead of pace",
      scope: { platform: "tiktok" },
      effect: { mode: "adjust-threshold", tolerancePercent: 30 },
      expiresAt: "2026-07-22T23:00:00.000Z",
      reason: "Front-loaded launch",
    });
    expect(args.effect.mode).toBe("adjust-threshold");
  });

  it("rejects arguments missing the required effect", () => {
    const result = recordCampaignDecisionArgsSchema.safeParse({
      campaignGroupId: "22222222-2222-2222-2222-222222222222",
      title: "No effect",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown effect mode", () => {
    const result = recordCampaignDecisionArgsSchema.safeParse({
      campaignGroupId: "22222222-2222-2222-2222-222222222222",
      title: "Bad mode",
      effect: { mode: "delete-everything" },
    });
    expect(result.success).toBe(false);
  });
});
