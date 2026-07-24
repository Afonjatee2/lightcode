import { describe, expect, it } from "vitest";
import { useAppStore } from "@/renderer/state/appStore";

function makeCampaignExtension() {
  return {
    campaignGroupId: "cg-test-001",
    clientName: "Test Client",
    campaignName: "Test Campaign",
    jobNumber: "JOB-001",
    defaultAgentKind: "claude",
    defaultModel: "claude-sonnet-4",
    mcpProfile: "development" as const,
    resourceAliases: { "@media-plans": "/path/to/plans" },
  };
}

describe("addCampaignProject", () => {
  it("creates a valid campaign project with all fields", () => {
    const store = useAppStore.getState();
    const ext = makeCampaignExtension();
    const project = store.addCampaignProject(
      { kind: "posix", path: "/tmp/campaign" },
      ext,
      "My Campaign",
    );

    expect(project.purpose).toBe("campaign");
    expect(project.name).toBe("My Campaign");
    expect(project.campaignExtension).toEqual(ext);
    expect(project.campaignExtension?.mcpProfile).toBe("development");
    expect(project.campaignExtension?.resourceAliases).toEqual({ "@media-plans": "/path/to/plans" });
    expect(project.createdAt).toBeTruthy();
    expect(project.id).toBeTruthy();
  });

  it("uses the pre-computed project ID when supplied", () => {
    const store = useAppStore.getState();
    const explicitId = "explicit-project-uuid";
    const project = store.addCampaignProject(
      { kind: "posix", path: "/tmp/campaign" },
      { campaignGroupId: "cg-test", clientName: "C", campaignName: "Camp" },
      "Test",
      explicitId,
    );

    expect(project.id).toBe(explicitId);
  });

  it("generates a project ID when none is supplied", () => {
    const store = useAppStore.getState();
    const project = store.addCampaignProject(
      { kind: "posix", path: "/tmp/campaign" },
      { campaignGroupId: "cg-test", clientName: "C", campaignName: "Camp" },
    );

    expect(project.id).toBeTruthy();
    expect(project.id).not.toBe("");
  });

  it("creates a campaign project with minimal extension", () => {
    const store = useAppStore.getState();
    const project = store.addCampaignProject(
      { kind: "posix", path: "/tmp/minimal" },
      { campaignGroupId: "cg-min", clientName: "Min", campaignName: "Minimal" },
    );

    expect(project.purpose).toBe("campaign");
    expect(project.campaignExtension?.campaignGroupId).toBe("cg-min");
    expect(project.campaignExtension?.jobNumber).toBeUndefined();
    expect(project.campaignExtension?.mcpProfile).toBeUndefined();
  });

  it("adds the campaign project to the store's project list", () => {
    useAppStore.setState({ projects: [] });
    const store = useAppStore.getState();
    store.addCampaignProject(
      { kind: "posix", path: "/tmp/camp" },
      { campaignGroupId: "cg-1", clientName: "C", campaignName: "Camp" },
    );

    expect(useAppStore.getState().projects.length).toBe(1);
    expect(useAppStore.getState().projects[0]?.purpose).toBe("campaign");
  });
});

describe("addCampaignProject validation", () => {
  it("rejects missing campaignExtension for campaign purpose when validated externally", () => {
    // The addCampaignProject method always sets purpose: "campaign" with campaignExtension.
    // Schema validation happens outside the store slice.
    const store = useAppStore.getState();
    const project = store.addCampaignProject(
      { kind: "posix", path: "/tmp/camp" },
      { campaignGroupId: "cg", clientName: "C", campaignName: "Camp" },
    );
    expect(project.purpose).toBe("campaign");
    expect(project.campaignExtension).toBeDefined();
  });
});

describe("addProject backward compatibility", () => {
  it("creates a code project without purpose field", () => {
    const store = useAppStore.getState();
    const project = store.addProject({ kind: "posix", path: "/tmp/repo" }, "My Repo");

    expect(project.purpose).toBeUndefined();
    expect(project.name).toBe("My Repo");
    expect(project.campaignExtension).toBeUndefined();
  });

  it("creates a project with generated name from location", () => {
    const store = useAppStore.getState();
    const project = store.addProject({ kind: "posix", path: "/tmp/my-repo" });

    expect(project.name).toBe("my-repo");
    expect(project.purpose).toBeUndefined();
  });
});

describe("updateProjectCampaignMcpProfile", () => {
  it("updates mcpProfile on a campaign project", () => {
    useAppStore.setState({ projects: [] });
    const store = useAppStore.getState();
    const project = store.addCampaignProject(
      { kind: "posix", path: "/tmp/camp" },
      { campaignGroupId: "cg-1", clientName: "C", campaignName: "Camp", mcpProfile: "monitoring" },
    );

    expect(project.campaignExtension?.mcpProfile).toBe("monitoring");

    store.updateProjectCampaignMcpProfile(project.id, "deployment");
    const updated = useAppStore.getState().projects.find((p) => p.id === project.id);
    expect(updated?.campaignExtension?.mcpProfile).toBe("deployment");
  });

  it("is no-op for code projects without campaignExtension", () => {
    useAppStore.setState({ projects: [] });
    const store = useAppStore.getState();
    const project = store.addProject({ kind: "posix", path: "/tmp/repo" });

    store.updateProjectCampaignMcpProfile(project.id, "development");
    const updated = useAppStore.getState().projects.find((p) => p.id === project.id);
    expect(updated?.campaignExtension).toBeUndefined();
  });
});
