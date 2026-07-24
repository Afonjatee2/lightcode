import { describe, expect, it, vi } from "vitest";
import type { McpToolCallResult } from "@/shared/contracts";
import type { RecordCampaignDecisionArgs } from "@/shared/contracts/campaign/controlCentreCampaignDecision";
import { submitCampaignDecision } from "./recordCampaignDecision";

const environment = { runtime: "host" as const, projectScoped: false };

const ARGS: RecordCampaignDecisionArgs = {
  campaignGroupId: "group-1",
  title: "Allow TikTok to run up to 30% ahead of pace",
  effect: { mode: "adjust-threshold", tolerancePercent: 30 },
  scope: { platform: "tiktok" },
  reason: "Front-loaded launch",
  expiresAt: "2026-07-22T23:00:00.000Z",
};

const detail = {
  id: "d1",
  campaignGroupId: "group-1",
  title: ARGS.title,
  description: null,
  decisionType: "pacing_exception",
  status: "active",
  effectiveStatus: "active",
  startsAt: "2026-07-20T12:00:00.000Z",
  expiresAt: "2026-07-22T23:00:00.000Z",
  revokedAt: null,
  createdAt: "2026-07-20T12:00:00.000Z",
  updatedAt: "2026-07-20T12:00:00.000Z",
  scope: { platform: "tiktok" },
  effect: { mode: "adjust-threshold", tolerancePercent: 30 },
  reason: "Front-loaded launch",
  createdByUserId: "u1",
  revokedByUserId: null,
};

describe("submitCampaignDecision", () => {
  it("dispatches record_campaign_decision with the correctly shaped arguments", async () => {
    const callTool = vi.fn<(t: string, a: unknown) => Promise<McpToolCallResult>>(() =>
      Promise.resolve({ status: "ok", content: detail, latencyMs: 1, environment }),
    );

    const result = await submitCampaignDecision(callTool, ARGS);

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("record_campaign_decision", ARGS);
    expect(result).toEqual({ ok: true, decision: expect.objectContaining({ id: "d1" }) });
  });

  it("surfaces a backend validation error verbatim", async () => {
    const backendMessage = 'Control Centre API error 400: {"message":"effect.mode is required"}';
    const callTool = vi.fn<() => Promise<McpToolCallResult>>(() =>
      Promise.resolve<McpToolCallResult>({
        status: "tool-error",
        message: backendMessage,
        latencyMs: 1,
        environment,
      }),
    );

    const result = await submitCampaignDecision(callTool, ARGS);

    expect(result).toEqual({ ok: false, message: backendMessage });
  });

  it("treats a recorded-but-unparseable detail as success (the write still happened)", async () => {
    const callTool = vi.fn<() => Promise<McpToolCallResult>>(() =>
      Promise.resolve<McpToolCallResult>({
        status: "ok",
        content: { unexpected: "shape" },
        latencyMs: 1,
        environment,
      }),
    );

    const result = await submitCampaignDecision(callTool, ARGS);
    expect(result).toEqual({ ok: true, decision: null });
  });
});
