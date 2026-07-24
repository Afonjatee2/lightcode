import { describe, expect, it } from "vitest";
import type { ConsultationContextPacketBody } from "@/shared/consultations";
import { REDACTION_PLACEHOLDER, redactPacketBody, redactText } from "./redact";

describe("secret redaction", () => {
  it("redacts common secret shapes in free text", () => {
    const input = [
      "aws key AKIAABCDEFGHIJKLMNOP",
      "github ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      "Authorization: Bearer abcdef123456.xyz",
      "api_key=supersecretvalue123",
      "sk-live-ABCDEFGHIJKLMNOP",
    ].join("\n");
    const result = redactText(input);
    expect(result.text).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(result.text).not.toContain("ghp_");
    expect(result.text).not.toContain("supersecretvalue123");
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
    expect(result.redactedCount).toBeGreaterThanOrEqual(4);
    expect(result.redactedFields).toContain("aws_access_key_id");
  });

  it("leaves ordinary campaign text untouched", () => {
    const result = redactText("Spend is pacing ahead of plan at 60% used.");
    expect(result.text).toBe("Spend is pacing ahead of plan at 60% used.");
    expect(result.redactedCount).toBe(0);
  });

  it("redacts secrets across packet string fields and records metadata", () => {
    const body = basePacket();
    body.explicitTask = "Check the token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 please";
    body.relevantRecentConversation = [
      { role: "user", content: "my password=hunter2secretvalue", messageId: "m1", createdAt: null },
    ];
    const { body: cleaned, metadata } = redactPacketBody(body);
    expect(cleaned.explicitTask).not.toContain("ghp_");
    expect(cleaned.relevantRecentConversation[0]?.content).not.toContain("hunter2secretvalue");
    expect(metadata.redactedCount).toBeGreaterThanOrEqual(2);
    expect(metadata.redactedFields.length).toBeGreaterThan(0);
  });
});

function basePacket(): ConsultationContextPacketBody {
  return {
    parentRequest: "@researcher check",
    explicitTask: "check",
    relevantRecentConversation: [],
    durableThreadSummary: null,
    campaignIdentity: { campaignGroupId: "g", campaignName: "C", clientName: null, status: "active" },
    dates: { startDate: "2026-06-01", endDate: "2026-08-31" },
    budget: { totalBudget: null, spentToDate: 0, remaining: null, percentUsed: null, expectedPercentUsed: null, pacingStatus: null },
    kpiEvidence: [],
    alerts: [],
    activeDecisions: [],
    pendingProposals: [],
    recentCampaignEvents: [],
    permittedAttachments: [],
    evidenceFreshness: { oldestCapturedAt: null, newestCapturedAt: null, staleSourceCount: 0, statuses: [] },
    missingDataWarnings: [],
    permissionConstraints: [],
    redactionMetadata: { redactedCount: 0, redactedFields: [], appliedAt: "2026-07-22T00:00:00.000Z" },
    createdAt: "2026-07-22T00:00:00.000Z",
    contractVersion: "consultation-context-v1",
    contentHash: "",
  };
}
