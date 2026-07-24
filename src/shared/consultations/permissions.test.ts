import { describe, expect, it } from "vitest";
import {
  CONSULTATION_CAPABILITIES,
  PermissionDeniedError,
  UNIVERSALLY_DENIED_CAPABILITIES,
  assertCan,
  can,
  capabilitiesForRole,
  describePermissionConstraints,
} from "./permissions";
import { CONSULTATION_ROLES } from "./types";

describe("permission policy matrix", () => {
  it("denies credentials and live platform actions for EVERY consultant role", () => {
    for (const role of CONSULTATION_ROLES) {
      expect(can(role, "access_credentials")).toBe(false);
      expect(can(role, "perform_live_platform_action")).toBe(false);
      expect(can(role, "approve_proposal")).toBe(false);
      expect(can(role, "apply_proposal")).toBe(false);
    }
  });

  it("grants the read-only baseline to every role", () => {
    for (const role of CONSULTATION_ROLES) {
      expect(can(role, "read_campaign_context")).toBe(true);
      expect(can(role, "read_campaign_events")).toBe(true);
      expect(can(role, "read_plan")).toBe(true);
      expect(can(role, "read_selected_attachments")).toBe(true);
    }
  });

  it("researcher may search the web and use a browser; others may not", () => {
    expect(can("researcher", "search_web")).toBe(true);
    expect(can("researcher", "use_browser")).toBe(true);
    expect(can("daily_operator", "search_web")).toBe(false);
    expect(can("figures_auditor", "use_browser")).toBe(false);
  });

  it("only the handoff writer may draft proposals and write handoff files", () => {
    expect(can("handoff_writer", "create_proposal_draft")).toBe(true);
    expect(can("handoff_writer", "modify_repository")).toBe(true);
    expect(can("strategic_reviewer", "create_proposal_draft")).toBe(false);
    expect(can("daily_operator", "modify_repository")).toBe(false);
  });

  it("no consultant role may run shell commands", () => {
    for (const role of CONSULTATION_ROLES) {
      expect(can(role, "run_shell")).toBe(false);
    }
  });

  it("assertCan throws PermissionDeniedError for prohibited actions", () => {
    expect(() => assertCan("daily_operator", "perform_live_platform_action")).toThrow(
      PermissionDeniedError,
    );
    expect(() => assertCan("researcher", "access_credentials")).toThrow(PermissionDeniedError);
    expect(() => assertCan("daily_operator", "read_campaign_context")).not.toThrow();
  });

  it("capabilitiesForRole never includes a universally-denied capability", () => {
    for (const role of CONSULTATION_ROLES) {
      const granted = capabilitiesForRole(role);
      for (const denied of UNIVERSALLY_DENIED_CAPABILITIES) {
        expect(granted).not.toContain(denied);
      }
      for (const capability of granted) {
        expect(CONSULTATION_CAPABILITIES).toContain(capability);
      }
    }
  });

  it("describePermissionConstraints surfaces the no-credentials/no-live-action boundary", () => {
    const lines = describePermissionConstraints("daily_operator").join("\n");
    expect(lines).toContain("credentials");
    expect(lines).toContain("live advertising-platform action");
  });
});
