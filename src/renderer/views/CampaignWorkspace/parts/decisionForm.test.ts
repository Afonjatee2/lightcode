import { describe, expect, it } from "vitest";
import {
  buildRecordDecisionArgs,
  emptyDecisionFormState,
  validateDecisionForm,
  type DecisionFormState,
} from "./decisionForm";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function state(overrides: Partial<DecisionFormState> = {}): DecisionFormState {
  return { ...emptyDecisionFormState(), ...overrides };
}

describe("validateDecisionForm", () => {
  it("requires a decision statement", () => {
    expect(validateDecisionForm(state({ title: "   " }), NOW)).toEqual({
      ok: false,
      errors: { title: "titleRequired" },
    });
  });

  it("requires a scope value once a channel/platform scope is chosen", () => {
    expect(
      validateDecisionForm(state({ title: "x", scopeType: "channel", scopeValue: "" }), NOW),
    ).toEqual({ ok: false, errors: { scopeValue: "scopeRequired" } });
  });

  it("rejects an expiry in the past so an already-expired decision can't be created", () => {
    expect(
      validateDecisionForm(state({ title: "x", expiresAtLocal: "2026-07-19T09:00" }), NOW),
    ).toEqual({ ok: false, errors: { expiresAt: "expiryPast" } });
  });

  it("rejects a non-numeric tolerance for adjust-threshold", () => {
    expect(
      validateDecisionForm(
        state({ title: "x", mode: "adjust-threshold", tolerancePercent: "lots" }),
        NOW,
      ),
    ).toEqual({ ok: false, errors: { tolerancePercent: "numberInvalid" } });
  });

  it("accepts a minimal valid decision (whole campaign, annotate, no expiry)", () => {
    expect(validateDecisionForm(state({ title: "Keep an eye on this" }), NOW).ok).toBe(true);
  });
});

describe("buildRecordDecisionArgs", () => {
  it("builds the exact tool shape with only the fields the operator filled", () => {
    const args = buildRecordDecisionArgs(
      state({
        title: "  Allow TikTok to run up to 30% ahead of pace  ",
        reason: "  Front-loaded launch  ",
        mode: "adjust-threshold",
        tolerancePercent: "30",
        scopeType: "platform",
        scopeValue: "tiktok",
      }),
      "group-1",
    );
    expect(args).toEqual({
      campaignGroupId: "group-1",
      title: "Allow TikTok to run up to 30% ahead of pace",
      reason: "Front-loaded launch",
      scope: { platform: "tiktok" },
      effect: { mode: "adjust-threshold", tolerancePercent: 30 },
    });
  });

  it("omits scope for whole-campaign decisions and omits blank optionals", () => {
    const args = buildRecordDecisionArgs(state({ title: "General note", mode: "annotate" }), "g");
    expect(args).toEqual({
      campaignGroupId: "g",
      title: "General note",
      effect: { mode: "annotate" },
    });
    expect("scope" in args).toBe(false);
    expect("reason" in args).toBe(false);
    expect("expiresAt" in args).toBe(false);
  });

  it("converts the datetime-local expiry to an ISO instant", () => {
    const local = "2026-07-22T23:00";
    const args = buildRecordDecisionArgs(state({ title: "x", expiresAtLocal: local }), "g");
    expect(args.expiresAt).toBe(new Date(local).toISOString());
  });
});
