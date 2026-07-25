import { describe, expect, it } from "vitest";
import {
  projectSchema,
  projectWithoutMcpServersSchema,
  projectPurposeSchema,
  campaignProjectExtensionSchema,
  getProjectPurpose,
  getCampaignMcpProfile,
  type CampaignProjectExtension,
} from "./project";

const baseProject = {
  id: "project-1",
  name: "Project",
  location: { kind: "posix" as const, path: "/repo" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("projectSchema campaign validation", () => {
  it("accepts legacy projects without an explicit purpose", () => {
    expect(projectSchema.safeParse(baseProject).success).toBe(true);
  });

  it("accepts campaigns with their required extension", () => {
    expect(
      projectSchema.safeParse({
        ...baseProject,
        purpose: "campaign",
        campaignExtension: {
          campaignGroupId: "group-1",
          clientName: "Client",
          campaignName: "Launch",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects campaigns without an extension at the campaignExtension field", () => {
    const result = projectSchema.safeParse({ ...baseProject, purpose: "campaign" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected campaign validation to fail");
    expect(result.error.issues[0]?.path).toEqual(["campaignExtension"]);
  });

  it("non-campaign project without campaignExtension passes", () => {
    const result = projectSchema.safeParse(baseProject);
    expect(result.success).toBe(true);
  });

  it("research project without campaignExtension passes", () => {
    const result = projectSchema.safeParse({ ...baseProject, purpose: "research" });
    expect(result.success).toBe(true);
  });

  it("general project without campaignExtension passes", () => {
    const result = projectSchema.safeParse({ ...baseProject, purpose: "general" });
    expect(result.success).toBe(true);
  });

  it("projectWithoutMcpServersSchema also validates campaign extension", () => {
    const result = projectWithoutMcpServersSchema.safeParse({
      ...baseProject,
      purpose: "campaign",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// campaignProjectExtensionSchema
// ============================================================================

describe("campaignProjectExtensionSchema", () => {
  const validExtension: CampaignProjectExtension = {
    campaignGroupId: "group-abc-123",
    clientName: "Acme Corp",
    campaignName: "Q4 Push",
  };

  it("parses a valid minimal extension", () => {
    const result = campaignProjectExtensionSchema.safeParse(validExtension);
    expect(result.success).toBe(true);
  });

  it("parses a fully populated extension with all optional fields", () => {
    const full = {
      ...validExtension,
      jobNumber: "ACME-2026-Q4-01",
      defaultAgentKind: "claude",
      defaultModel: "claude-sonnet-5",
      mcpProfile: "development" as const,
      resourceAliases: { "@media-plans": "//shared/media/plan.pdf" },
    };
    const result = campaignProjectExtensionSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.jobNumber).toBe("ACME-2026-Q4-01");
    expect(result.data.defaultAgentKind).toBe("claude");
    expect(result.data.defaultModel).toBe("claude-sonnet-5");
    expect(result.data.mcpProfile).toBe("development");
    expect(result.data.resourceAliases?.["@media-plans"]).toBe("//shared/media/plan.pdf");
  });

  it("rejects missing campaignGroupId", () => {
    const { campaignGroupId: _, ...missing } = validExtension;
    expect(campaignProjectExtensionSchema.safeParse(missing).success).toBe(false);
  });

  it("accepts empty campaignGroupId for unlinked workspaces", () => {
    expect(
      campaignProjectExtensionSchema.safeParse({ ...validExtension, campaignGroupId: "" }).success,
    ).toBe(true);
  });

  it("rejects missing clientName", () => {
    const { clientName: _, ...missing } = validExtension;
    expect(campaignProjectExtensionSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects empty clientName", () => {
    expect(
      campaignProjectExtensionSchema.safeParse({ ...validExtension, clientName: "" }).success,
    ).toBe(false);
  });

  it("rejects missing campaignName", () => {
    const { campaignName: _, ...missing } = validExtension;
    expect(campaignProjectExtensionSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects empty campaignName", () => {
    expect(
      campaignProjectExtensionSchema.safeParse({ ...validExtension, campaignName: "" }).success,
    ).toBe(false);
  });

  it("optional fields survive as undefined when omitted", () => {
    const result = campaignProjectExtensionSchema.safeParse(validExtension);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.jobNumber).toBeUndefined();
    expect(result.data.defaultAgentKind).toBeUndefined();
    expect(result.data.defaultModel).toBeUndefined();
    expect(result.data.mcpProfile).toBeUndefined();
    expect(result.data.resourceAliases).toBeUndefined();
  });

  it("does not invent empty strings for missing campaign identity", () => {
    const result = campaignProjectExtensionSchema.safeParse({
      campaignGroupId: "",
      clientName: "",
      campaignName: "",
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// projectPurposeSchema
// ============================================================================

describe("projectPurposeSchema", () => {
  it("accepts 'code'", () => {
    expect(projectPurposeSchema.safeParse("code").success).toBe(true);
  });

  it("accepts 'campaign'", () => {
    expect(projectPurposeSchema.safeParse("campaign").success).toBe(true);
  });

  it("accepts 'research'", () => {
    expect(projectPurposeSchema.safeParse("research").success).toBe(true);
  });

  it("accepts 'general'", () => {
    expect(projectPurposeSchema.safeParse("general").success).toBe(true);
  });

  it("rejects unknown purpose", () => {
    expect(projectPurposeSchema.safeParse("analytics").success).toBe(false);
  });
});

// ============================================================================
// getProjectPurpose
// ============================================================================

describe("getProjectPurpose", () => {
  it("returns 'code' for project without purpose", () => {
    const project = { ...baseProject };
    expect(getProjectPurpose(project)).toBe("code");
  });

  it("returns the purpose when set to campaign", () => {
    const project = { ...baseProject, purpose: "campaign" as const };
    expect(getProjectPurpose(project)).toBe("campaign");
  });

  it("returns the purpose when set to research", () => {
    const project = { ...baseProject, purpose: "research" as const };
    expect(getProjectPurpose(project)).toBe("research");
  });

  it("returns the purpose when set to general", () => {
    const project = { ...baseProject, purpose: "general" as const };
    expect(getProjectPurpose(project)).toBe("general");
  });
});

// ============================================================================
// getCampaignMcpProfile
// ============================================================================

describe("getCampaignMcpProfile", () => {
  it("defaults to 'plan_revision' for project without campaignExtension", () => {
    const project = { ...baseProject };
    expect(getCampaignMcpProfile(project)).toBe("plan_revision");
  });

  it("defaults to 'plan_revision' when mcpProfile is unset in extension", () => {
    const project = {
      ...baseProject,
      purpose: "campaign" as const,
      campaignExtension: {
        campaignGroupId: "g-1",
        clientName: "Acme",
        campaignName: "Q4",
      },
    };
    expect(getCampaignMcpProfile(project)).toBe("plan_revision");
  });

  it("returns the configured mcpProfile when set", () => {
    const project = {
      ...baseProject,
      purpose: "campaign" as const,
      campaignExtension: {
        campaignGroupId: "g-1",
        clientName: "Acme",
        campaignName: "Q4",
        mcpProfile: "development" as const,
      },
    };
    expect(getCampaignMcpProfile(project)).toBe("development");
  });

  it("is safe to call on any project shape", () => {
    const project = {
      ...baseProject,
      purpose: "code" as const,
      campaignExtension: {
        campaignGroupId: "g-1",
        clientName: "Acme",
        campaignName: "Q4",
        mcpProfile: "development" as const,
      },
    };
    expect(getCampaignMcpProfile(project)).toBe("development");
  });
});

// ============================================================================
// Refined Project schemas across remote protocol transformations
// ============================================================================

describe("projectWithoutMcpServersSchema remote-safe transformations", () => {
  it("strips mcpServers but retains campaignExtension", () => {
    const project = projectSchema.parse({
      ...baseProject,
      purpose: "campaign",
      campaignExtension: {
        campaignGroupId: "g-1",
        clientName: "Acme",
        campaignName: "Q4",
      },
    });

    const remote = projectWithoutMcpServersSchema.parse(project);
    expect("mcpServers" in remote).toBe(false);
    expect(remote.campaignExtension).toBeDefined();
    expect(remote.campaignExtension?.campaignGroupId).toBe("g-1");
  });

  it("survives JSON round-trip through remote protocol", () => {
    const project = projectSchema.parse({
      ...baseProject,
      purpose: "campaign",
      campaignExtension: {
        campaignGroupId: "g-1",
        clientName: "Acme",
        campaignName: "Q4",
        mcpProfile: "plan_revision",
        resourceAliases: { "@plans": "/path/to/plans" },
      },
    });

    const json = JSON.stringify(project);
    const parsed = JSON.parse(json);
    const remote = projectWithoutMcpServersSchema.parse(parsed);
    expect(remote.purpose).toBe("campaign");
    expect(remote.campaignExtension?.mcpProfile).toBe("plan_revision");
    expect(remote.campaignExtension?.resourceAliases).toEqual({ "@plans": "/path/to/plans" });
  });
});
