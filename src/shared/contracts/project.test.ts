import { describe, expect, it } from "vitest";
import { projectSchema, type Project } from "./project";

function makePhase3CampaignProject(overrides: Partial<Project> = {}): Project {
  return projectSchema.parse({
    id: "proj-campaign-1",
    name: "Q3 Brand Launch",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: "cg-abc-123",
      clientName: "Acme Corp",
      campaignName: "Q3 Brand Launch",
      jobNumber: "JOB-2026-001",
      defaultAgentKind: "codex",
      defaultModel: "gpt-5",
      mcpProfile: "monitoring",
      resourceAliases: { "@media-plans": "https://drive.example.com/plans" },
    },
    location: { kind: "posix", path: "/projects/q3-brand-launch" },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("Phase 3 campaign project contract", () => {
  it("accepts a full Phase 3 campaign project with all extension fields", () => {
    const project = makePhase3CampaignProject();
    expect(project.purpose).toBe("campaign");
    expect(project.campaignExtension?.campaignGroupId).toBe("cg-abc-123");
    expect(project.campaignExtension?.clientName).toBe("Acme Corp");
    expect(project.campaignExtension?.campaignName).toBe("Q3 Brand Launch");
    expect(project.campaignExtension?.jobNumber).toBe("JOB-2026-001");
    expect(project.campaignExtension?.defaultAgentKind).toBe("codex");
    expect(project.campaignExtension?.defaultModel).toBe("gpt-5");
    expect(project.campaignExtension?.mcpProfile).toBe("monitoring");
    expect(project.campaignExtension?.resourceAliases).toEqual({ "@media-plans": "https://drive.example.com/plans" });
  });

  it("requires campaignExtension when purpose is campaign", () => {
    const result = projectSchema.safeParse({
      id: "p-1",
      name: "Bad Campaign",
      purpose: "campaign",
      location: { kind: "posix", path: "/tmp/test" },
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("allows code projects without campaignExtension", () => {
    const result = projectSchema.safeParse({
      id: "p-1",
      name: "Code Project",
      purpose: "code",
      location: { kind: "posix", path: "/tmp/test" },
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("defaults purpose to code when omitted", () => {
    const parsed = projectSchema.safeParse({
      id: "p-1",
      name: "Default Project",
      location: { kind: "posix", path: "/tmp/test" },
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.purpose).toBeUndefined();
  });
});
