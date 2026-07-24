// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { McpServer, Project, Thread } from "@/shared/contracts";
import {
  findCampaignProjectByGroupId,
  projectActivityTimestamp,
  selectTodayDataProject,
} from "./resolveTodayDataSource";

const controlCentreServer: McpServer = {
  id: "cc-1",
  name: "Control-Centre",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "http", url: "https://cc.example.com/mcp", headers: {} },
};

function campaignProject(overrides: Partial<Project> & Pick<Project, "id">): Project {
  return {
    name: overrides.id,
    location: { kind: "posix", path: `/repo/${overrides.id}` },
    createdAt: "2026-01-01T00:00:00.000Z",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: `cg-${overrides.id}`,
      clientName: "Client",
      campaignName: "Campaign",
    },
    mcpServers: [controlCentreServer],
    ...overrides,
  };
}

describe("projectActivityTimestamp", () => {
  it("uses the newest thread update when present", () => {
    const project = campaignProject({ id: "p1", createdAt: "2026-01-01T00:00:00.000Z" });
    const threads: Thread[] = [
      {
        id: "t1",
        projectId: "p1",
        title: "Thread",
        agentKind: "claude",
        config: { model: "claude-sonnet-4" },
        status: "idle",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    expect(projectActivityTimestamp(project, threads)).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("selectTodayDataProject", () => {
  it("returns undefined when no campaign project has Control Centre configured", () => {
    const project = campaignProject({ id: "p1", mcpServers: [] });
    expect(selectTodayDataProject([project], [], [])).toBeUndefined();
  });

  it("prefers the most recently active campaign project", () => {
    const older = campaignProject({ id: "older", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = campaignProject({ id: "newer", createdAt: "2026-02-01T00:00:00.000Z" });
    const threads: Thread[] = [
      {
        id: "t1",
        projectId: "older",
        title: "Old",
        agentKind: "claude",
        config: { model: "claude-sonnet-4" },
        status: "idle",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    expect(selectTodayDataProject([older, newer], [], threads)).toBe("older");
  });
});

describe("findCampaignProjectByGroupId", () => {
  it("matches on campaign extension group id", () => {
    const project = campaignProject({
      id: "p1",
      campaignExtension: {
        campaignGroupId: "group-abc",
        clientName: "Client",
        campaignName: "Campaign",
      },
    });
    expect(findCampaignProjectByGroupId([project], "group-abc")?.id).toBe("p1");
    expect(findCampaignProjectByGroupId([project], "missing")).toBeUndefined();
  });
});
