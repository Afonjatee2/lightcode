import { describe, expect, it } from "vitest";
import {
  NoProviderForRoleError,
  ProviderAuthError,
  ProviderUnavailableError,
  resolveCampaignGroupId,
  resolveCommand,
  resolveProvider,
  resolveRole,
} from "./resolve";
import type { AvailableProvider } from "./resolve";

const catalog: AvailableProvider[] = [
  { provider: "claude", models: ["claude-fast", "claude-max"], authenticated: true, roles: ["strategic_reviewer"] },
  { provider: "codex", models: ["codex-balanced"], authenticated: true, roles: ["figures_auditor"] },
  { provider: "gemini", models: ["gemini-1"], authenticated: false },
];

describe("resolveCampaignGroupId", () => {
  it("returns the group ID for a Phase 3 campaign project with purpose: campaign", () => {
    expect(
      resolveCampaignGroupId({
        purpose: "campaign",
        campaignExtension: { campaignGroupId: "cg-phase3" },
      }),
    ).toBe("cg-phase3");
  });

  it("returns undefined for a code project even with campaignExtension present", () => {
    expect(
      resolveCampaignGroupId({
        purpose: "code",
        campaignExtension: { campaignGroupId: "cg-123" },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when no purpose or campaignExtension is set", () => {
    expect(resolveCampaignGroupId({})).toBeUndefined();
  });

  it("returns undefined when purpose is campaign but campaignExtension is absent", () => {
    expect(resolveCampaignGroupId({ purpose: "campaign" })).toBeUndefined();
  });
});

describe("command resolution", () => {
  it("maps role names and aliases to a role + mode", () => {
    expect(resolveCommand("daily_operator")).toEqual({ role: "daily_operator", mode: "standard" });
    expect(resolveCommand("@strategic_reviewer")).toEqual({ role: "strategic_reviewer", mode: "standard" });
    expect(resolveCommand("auditor")).toEqual({ role: "figures_auditor", mode: "standard" });
    expect(resolveCommand("research")).toEqual({ role: "researcher", mode: "standard" });
  });

  it("maps panel/finalise commands to their execution modes", () => {
    expect(resolveCommand("panel")).toEqual({ role: "panel", mode: "panel" });
    expect(resolveCommand("finalise")).toEqual({ role: "finaliser", mode: "finalise" });
    expect(resolveCommand("finalize")).toEqual({ role: "finaliser", mode: "finalise" });
  });

  it("returns null for unknown commands", () => {
    expect(resolveCommand("nonsense")).toBeNull();
    expect(resolveCommand("")).toBeNull();
  });
});

describe("role resolution", () => {
  it("validates canonical role ids and rejects others", () => {
    expect(resolveRole("verifier")).toBe("verifier");
    expect(resolveRole("PANEL")).toBe("panel");
    expect(resolveRole("development")).toBeNull();
    expect(resolveRole("nope")).toBeNull();
  });
});

describe("provider resolution", () => {
  it("honours an explicit authenticated requested provider + model", () => {
    const result = resolveProvider({
      role: "strategic_reviewer",
      requestedProvider: "claude",
      requestedModel: "claude-max",
      catalog,
    });
    expect(result).toEqual({ actualProvider: "claude", actualModel: "claude-max" });
  });

  it("falls back to the provider's first model when the requested model is unknown", () => {
    const result = resolveProvider({
      role: "strategic_reviewer",
      requestedProvider: "claude",
      requestedModel: "does-not-exist",
      catalog,
    });
    expect(result.actualModel).toBe("claude-fast");
  });

  it("throws ProviderUnavailableError for an uninstalled provider", () => {
    expect(() =>
      resolveProvider({ role: "researcher", requestedProvider: "openai", requestedModel: null, catalog }),
    ).toThrow(ProviderUnavailableError);
  });

  it("throws ProviderAuthError for an installed-but-unauthenticated provider", () => {
    expect(() =>
      resolveProvider({ role: "researcher", requestedProvider: "gemini", requestedModel: null, catalog }),
    ).toThrow(ProviderAuthError);
  });

  it("prefers a role-matching authenticated provider when none is requested", () => {
    const result = resolveProvider({ role: "figures_auditor", requestedProvider: null, requestedModel: null, catalog });
    expect(result.actualProvider).toBe("codex");
  });

  it("falls back to the first authenticated provider when no role match exists", () => {
    const result = resolveProvider({ role: "challenger", requestedProvider: null, requestedModel: null, catalog });
    expect(result.actualProvider).toBe("claude");
  });

  it("throws NoProviderForRoleError when nothing is authenticated", () => {
    expect(() =>
      resolveProvider({ role: "researcher", requestedProvider: null, requestedModel: null, catalog: [{ provider: "x", models: ["m"], authenticated: false }] }),
    ).toThrow(NoProviderForRoleError);
  });
});
