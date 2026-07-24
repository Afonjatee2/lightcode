import { describe, expect, it } from "vitest";
import {
  checkToolPolicy,
  filterAllowedTools,
  requireApprovedTools,
  looksLikePlatformWrite,
  CAMPAIGN_DEPLOYMENT_POLICY,
} from "./profilePolicy";

describe("CAMPAIGN_DEPLOYMENT_POLICY", () => {
  it("has a descriptive label", () => {
    expect(CAMPAIGN_DEPLOYMENT_POLICY.label).toBe("Campaign Deployment");
  });

  it("disallows direct platform writes", () => {
    expect(CAMPAIGN_DEPLOYMENT_POLICY.allowsDirectPlatformWrite).toBe(false);
  });

  it("describes that operators must approve proposals", () => {
    expect(CAMPAIGN_DEPLOYMENT_POLICY.description).toContain("approve");
    expect(CAMPAIGN_DEPLOYMENT_POLICY.description).toContain("never writes directly");
  });
});

describe("checkToolPolicy", () => {
  describe("allowed read patterns", () => {
    const allowedReads = [
      "list_pending_action_proposals",
      "list_campaign_groups",
      "get_action_proposal",
      "get_plan",
      "find_latest",
      "compare_plan",
      "ask_analyst",
      "explain_rule",
      "record_campaign_note",
      "import_media_plan",
      "draft_email",
    ];

    it.each(allowedReads)("allows read tool: %s", (toolName) => {
      const result = checkToolPolicy(toolName);
      expect(result.allowed).toBe(true);
      expect(result.denied).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe("proposal management patterns", () => {
    const proposalTools = [
      "propose_plan_changes",
      "create_action_proposal",
      "submit_action_proposal",
    ];

    it.each(proposalTools)("allows proposal tool: %s", (toolName) => {
      const result = checkToolPolicy(toolName);
      expect(result.allowed).toBe(true);
      expect(result.denied).toBe(false);
    });
  });

  describe("approval patterns", () => {
    it("allows approve_action_proposal but requires approval", () => {
      const result = checkToolPolicy("approve_action_proposal");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    it("allows reject_action_proposal but requires approval", () => {
      const result = checkToolPolicy("reject_action_proposal");
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });

    it("allows approve_plan_update_proposal and requires approval", () => {
      const result = checkToolPolicy("approve_plan_update_proposal");
      expect(result.allowed).toBe(true);
      expect(result.denied).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("denied platform-write patterns", () => {
    const deniedTools = [
      "apply_campaign_changes",
      "platform_write_budget",
      "ad_platform.meta_ads.set_budget",
      "meta_ads.campaign_update",
      "google_ads.create_campaign",
      "tiktok_ads.creative_upload",
      "campaign.create",
      "budget.set",
      "creative.upload",
      "audience.update",
      "bid.adjust",
      "ad.create",
      "publish_to_platform",
      "deploy_campaign",
      "launch_campaign",
      "direct_apply_whatever",
    ];

    it.each(deniedTools)("denies platform-write tool: %s", (toolName) => {
      const result = checkToolPolicy(toolName);
      expect(result.allowed).toBe(false);
      expect(result.denied).toBe(true);
      // Either explicit "never writes directly" or heuristic "platform-write heuristics"
      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe("string");
    });
  });

  describe("unknown tools", () => {
    it("defers non-write unknown tools (neither allowed nor denied)", () => {
      const result = checkToolPolicy("unknown_read_tool");
      expect(result.allowed).toBe(false);
      expect(result.denied).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toContain("not in the Deployment profile allow-list");
    });

    it("denies unknown write-looking tools by heuristic", () => {
      const result = checkToolPolicy("unknown_apply_campaign");
      expect(result.allowed).toBe(false);
      expect(result.denied).toBe(true);
      expect(result.reason).toContain("platform-write heuristics");
    });

    it("denies unknown tools with platform prefixes", () => {
      const result = checkToolPolicy("google_something_new");
      expect(result.allowed).toBe(false);
      expect(result.denied).toBe(true);
    });
  });

  describe("denied patterns win over allowed", () => {
    it("denies exact match denied pattern even if it matches allowed prefix", () => {
      // "apply_" is in denied patterns; "get_" is in allowed patterns
      // "apply_proposal" should still be denied
      const result = checkToolPolicy("apply_proposal");
      expect(result.allowed).toBe(false);
      expect(result.denied).toBe(true);
    });
  });
});

describe("looksLikePlatformWrite", () => {
  const writeTools = [
    "apply_budget",
    "write_to_platform",
    "create_campaign",
    "update_bid",
    "delete_ad",
    "mutate_audience",
    "insert_targeting",
    "upsert_creative",
    "set_budget",
    "publish_changes",
    "deploy_all",
    "launch_now",
    "push_to_ads",
    "execute_workflow",
    "run_platform_job",
    "meta_ads_something",
    "google_ads_something",
    "tiktok_something",
    "linkedin_ads_update",
  ];

  it.each(writeTools)("detects write tool: %s", (toolName) => {
    expect(looksLikePlatformWrite(toolName)).toBe(true);
  });

  it("does not flag safe tools", () => {
    const safeTools = [
      "list_proposals",
      "get_proposal",
      "read_plan",
      "fetch_alerts",
      "view_dashboard",
      "check_status",
    ];
    for (const t of safeTools) {
      expect(looksLikePlatformWrite(t)).toBe(false);
    }
  });
});

describe("filterAllowedTools", () => {
  it("separates allowed and denied tools", () => {
    const tools = [
      "get_proposal",
      "apply_campaign",
      "list_pending",
      "unknown_tool",
      "meta_ads.create",
    ];
    const { allowed, denied } = filterAllowedTools(tools);
    expect(allowed).toContain("get_proposal");
    expect(allowed).toContain("list_pending");
    expect(denied.map((d) => d.name)).toContain("apply_campaign");
    expect(denied.map((d) => d.name)).toContain("meta_ads.create");
    // unknown_tool is neither allowed nor denied (deferred)
    expect(allowed).not.toContain("unknown_tool");
    expect(denied.map((d) => d.name)).not.toContain("unknown_tool");
  });
});

describe("requireApprovedTools", () => {
  it("returns allowed tools when no denied tools", () => {
    const tools = ["get_proposal", "list_pending"];
    const result = requireApprovedTools(tools);
    expect(result).toEqual(tools);
  });

  it("throws when a denied tool is present", () => {
    expect(() => requireApprovedTools(["get_proposal", "apply_campaign"])).toThrow(
      "denied by the Campaign Deployment profile policy",
    );
  });
});
