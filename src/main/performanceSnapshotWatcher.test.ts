import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/shared/contracts";
import {
  PerformanceSnapshotWatcher,
  type PerformanceSnapshotListener,
} from "./performanceSnapshotWatcher";

const validSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-25T12:54:00.000Z",
  source: "chat fetch",
  channels: [{ channel: "Meta", spend: 100, status: "on_track" }],
};

function makeCampaignProject(id: string, workspaceRoot: string): Project {
  return {
    id,
    name: "Campaign",
    purpose: "campaign",
    location: { kind: "posix", path: workspaceRoot },
    campaignExtension: {
      campaignGroupId: "cg-1",
      clientName: "Client",
      campaignName: "Campaign",
    },
    disabled: false,
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("PerformanceSnapshotWatcher", () => {
  let workspaceRoot: string;
  let watcher: PerformanceSnapshotWatcher;
  let listener: ReturnType<typeof vi.fn<PerformanceSnapshotListener>>;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "lc-perf-snap-"));
    watcher = new PerformanceSnapshotWatcher();
    listener = vi.fn<PerformanceSnapshotListener>();
    watcher.setListener(listener);
  });

  afterEach(() => {
    watcher.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reads an existing snapshot once when a campaign project is registered", () => {
    const cockpitDir = join(workspaceRoot, ".cockpit");
    mkdirSync(cockpitDir, { recursive: true });
    writeFileSync(join(cockpitDir, "performance-snapshot.json"), JSON.stringify(validSnapshot));

    watcher.watchProject(makeCampaignProject("p1", workspaceRoot));

    expect(listener).toHaveBeenCalledWith("p1", expect.objectContaining({ source: "chat fetch" }));
  });

  it("pushes parsed snapshot on file change", async () => {
    const cockpitDir = join(workspaceRoot, ".cockpit");
    mkdirSync(cockpitDir, { recursive: true });
    const snapshotPath = join(cockpitDir, "performance-snapshot.json");

    watcher.watchProject(makeCampaignProject("p1", workspaceRoot));
    listener.mockClear();

    writeFileSync(snapshotPath, JSON.stringify(validSnapshot));

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ source: "chat fetch" }),
      );
    });
  });

  it("warns and does not push invalid snapshot files", async () => {
    const warn = vi.fn<(message: string) => void>();
    watcher.setWarnHandler(warn);
    const cockpitDir = join(workspaceRoot, ".cockpit");
    mkdirSync(cockpitDir, { recursive: true });
    const snapshotPath = join(cockpitDir, "performance-snapshot.json");

    watcher.watchProject(makeCampaignProject("p1", workspaceRoot));
    listener.mockClear();

    writeFileSync(snapshotPath, "{ not valid json");

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(warn).toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not crash when snapshot file is missing", () => {
    watcher.watchProject(makeCampaignProject("p1", workspaceRoot));
    expect(listener).toHaveBeenCalledWith("p1", null);
    expect(existsSync(join(workspaceRoot, ".cockpit"))).toBe(true);
  });
});
