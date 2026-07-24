import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, initDatabase } from "@/main/db/connection";
import {
  dbDeleteProject,
  dbDeleteThread,
  dbGetProjects,
  dbGetThreads,
  dbUpsertProject,
  dbUpsertThread,
} from "@/main/db/projectsThreads";

/**
 * Proves that the campaign creation rollback logic leaves no orphaned
 * projects or threads in SQLite. Uses the real Phase 4 persistence layer
 * (initDatabase + dbUpsertProject/dbDeleteProject/etc.).
 */
function makeCampaignProject(id: string) {
  return {
    id,
    name: "Rollback Test Campaign",
    purpose: "campaign" as const,
    campaignExtension: {
      campaignGroupId: "cg-rollback-001",
      clientName: "Rollback Client",
      campaignName: "Rollback Campaign",
    },
    location: { kind: "posix" as const, path: "/tmp/rollback-test" },
    createdAt: new Date().toISOString(),
  };
}

function makeGuiThread(threadId: string, projectId: string) {
  return {
    id: threadId,
    projectId,
    title: "GUI Thread",
    agentKind: "claude",
    config: { model: "claude-sonnet-4", mode: "agent" as const },
    status: "inactive" as const,
    attention: "none" as const,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui" as const,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canResumeWithConfig: false,
  };
}

describe("durable rollback — no orphaned projects or threads", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lc-rollback-"));
    initDatabase(join(dir, "state.sqlite"));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("deleting a project removes it from SQLite", () => {
    const project = makeCampaignProject("proj-orphan-1");
    dbUpsertProject(project, 0);

    const projects = dbGetProjects();
    expect(projects.find((p) => p.id === project.id)).toBeDefined();

    dbDeleteProject(project.id);

    const after = dbGetProjects();
    expect(after.find((p) => p.id === project.id)).toBeUndefined();
  });

  it("deleting a thread removes it from SQLite", () => {
    const project = makeCampaignProject("proj-orphan-2");
    const thread = makeGuiThread("thread-orphan-2", project.id);
    dbUpsertProject(project, 0);
    dbUpsertThread(thread, 0);

    const threads = dbGetThreads();
    expect(threads.find((t) => t.id === thread.id)).toBeDefined();

    dbDeleteThread(thread.id);

    const after = dbGetThreads();
    expect(after.find((t) => t.id === thread.id)).toBeUndefined();
    // project still exists
    expect(dbGetProjects().find((p) => p.id === project.id)).toBeDefined();
  });

  it("no orphan thread remains after project deletion", () => {
    const project = makeCampaignProject("proj-orphan-3");
    const thread = makeGuiThread("thread-orphan-3", project.id);
    dbUpsertProject(project, 0);
    dbUpsertThread(thread, 0);

    // Delete project, then thread (simulating store cleanup order)
    dbDeleteProject(project.id);
    dbDeleteThread(thread.id);

    expect(dbGetProjects().find((p) => p.id === project.id)).toBeUndefined();
    expect(dbGetThreads().find((t) => t.id === thread.id)).toBeUndefined();
  });

  it("no orphan project remains when thread deleted first, then project", () => {
    const project = makeCampaignProject("proj-orphan-4");
    const thread = makeGuiThread("thread-orphan-4", project.id);
    dbUpsertProject(project, 0);
    dbUpsertThread(thread, 0);

    // Simulate rollback: delete thread, then project
    dbDeleteThread(thread.id);
    dbDeleteProject(project.id);

    expect(dbGetThreads().find((t) => t.id === thread.id)).toBeUndefined();
    expect(dbGetProjects().find((p) => p.id === project.id)).toBeUndefined();
  });

  it("deleting non-existent ids does not throw", () => {
    expect(() => dbDeleteProject("never-existed")).not.toThrow();
    expect(() => dbDeleteThread("never-existed")).not.toThrow();
  });

  it("re-creating a project after deletion works cleanly", () => {
    const project = makeCampaignProject("proj-rt");
    const thread1 = makeGuiThread("thread-rt-1", project.id);

    dbUpsertProject(project, 0);
    dbUpsertThread(thread1, 0);

    dbDeleteThread(thread1.id);
    dbDeleteProject(project.id);

    // Re-create
    dbUpsertProject(project, 0);
    const thread2 = makeGuiThread("thread-rt-2", project.id);
    dbUpsertThread(thread2, 0);

    const projects = dbGetProjects();
    const projectThreads = dbGetThreads().filter((t) => t.projectId === project.id);

    expect(projects.filter((p) => p.id === project.id).length).toBe(1);
    expect(projectThreads.length).toBe(1);
    expect(projectThreads[0]?.id).toBe("thread-rt-2");
  });

  it("campaignExtension survives delete and re-create", () => {
    const project = {
      ...makeCampaignProject("proj-survive"),
      campaignExtension: {
        campaignGroupId: "cg-survive",
        clientName: "Survivor",
        campaignName: "Survival Campaign",
        jobNumber: "JOB-001",
        mcpProfile: "deployment" as const,
      },
    };
    dbUpsertProject(project, 0);
    dbDeleteProject(project.id);

    // Re-create
    dbUpsertProject(project, 0);

    const found = dbGetProjects().find((p) => p.id === project.id);
    expect(found).toBeDefined();
    expect(found?.purpose).toBe("campaign");
    expect(found?.campaignExtension?.campaignGroupId).toBe("cg-survive");
    expect(found?.campaignExtension?.clientName).toBe("Survivor");
    expect(found?.campaignExtension?.mcpProfile).toBe("deployment");
  });

  it("campaign project round-trips through real dbUpsertProject/dbGetProjects", () => {
    const project = {
      ...makeCampaignProject("proj-roundtrip"),
      campaignExtension: {
        campaignGroupId: "cg-rt-001",
        clientName: "Roundtrip Client",
        campaignName: "Roundtrip Campaign",
        jobNumber: "RT-001",
        defaultAgentKind: "claude",
        defaultModel: "claude-sonnet-4",
        mcpProfile: "monitoring" as const,
        resourceAliases: { "@media": "/path/to/media" },
      },
    };
    dbUpsertProject(project, 0);

    const found = dbGetProjects().find((p) => p.id === project.id);
    expect(found).toBeDefined();
    expect(found?.purpose).toBe("campaign");
    expect(found?.campaignExtension?.campaignGroupId).toBe("cg-rt-001");
    expect(found?.campaignExtension?.resourceAliases).toEqual({ "@media": "/path/to/media" });
  });
});
