import { existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import type { Project } from "@/shared/contracts";
import type { PerformanceSnapshot } from "@/shared/contracts/campaign/performanceSnapshot";
import {
  parsePerformanceSnapshotFileContents,
  PERFORMANCE_SNAPSHOT_FILENAME,
} from "@/shared/contracts/campaign/performanceSnapshot";
import {
  listCampaignProjects,
  resolveCampaignWorkspaceRoot,
  resolvePerformanceSnapshotCockpitDir,
  resolvePerformanceSnapshotPath,
} from "./performanceSnapshotPaths";

const DEBOUNCE_MS = 300;

/**
 * Agents write this file; treat it as untrusted input. A snapshot is a small
 * JSON document — anything above this size is malformed or hostile, and an
 * uncapped readFileSync of a huge file would balloon main-process memory.
 */
const MAX_SNAPSHOT_FILE_BYTES = 1_000_000;

export type PerformanceSnapshotListener = (
  projectId: string,
  snapshot: PerformanceSnapshot | null,
) => void;

export type PerformanceSnapshotWarn = (message: string) => void;

interface WatcherEntry {
  projectId: string;
  snapshotPath: string;
  watcher: FSWatcher | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class PerformanceSnapshotWatcher {
  private readonly entries = new Map<string, WatcherEntry>();
  private listener: PerformanceSnapshotListener | null = null;
  private warn: PerformanceSnapshotWarn = (message) => {
    console.warn(message);
  };

  setListener(listener: PerformanceSnapshotListener | null): void {
    this.listener = listener;
  }

  setWarnHandler(handler: PerformanceSnapshotWarn): void {
    this.warn = handler;
  }

  syncProjects(projects: Project[]): void {
    const campaignProjects = listCampaignProjects(projects);
    const activeIds = new Set(campaignProjects.map((project) => project.id));

    for (const projectId of this.entries.keys()) {
      if (!activeIds.has(projectId)) {
        this.unwatch(projectId);
      }
    }

    for (const project of campaignProjects) {
      this.watchProject(project);
    }
  }

  watchProject(project: Project): void {
    const workspaceRoot = resolveCampaignWorkspaceRoot(project.location);
    if (!workspaceRoot) return;

    const cockpitDir = resolvePerformanceSnapshotCockpitDir(workspaceRoot);
    const snapshotPath = resolvePerformanceSnapshotPath(workspaceRoot);

    const existing = this.entries.get(project.id);
    if (existing?.snapshotPath === snapshotPath) {
      this.readAndEmit(project.id, snapshotPath);
      return;
    }

    if (existing) {
      this.unwatch(project.id);
    }

    try {
      if (!existsSync(cockpitDir)) {
        mkdirSync(cockpitDir, { recursive: true });
      }
    } catch {
      return;
    }

    const entry: WatcherEntry = {
      projectId: project.id,
      snapshotPath,
      watcher: null,
      debounceTimer: null,
    };

    try {
      entry.watcher = watch(cockpitDir, { persistent: false }, (_eventType, filename) => {
        if (filename !== PERFORMANCE_SNAPSHOT_FILENAME) return;
        this.scheduleRead(entry);
      });
      // Without a handler, a watcher error (dir deleted, EPERM, EBADF) is an
      // unhandled 'error' event and crashes the main process. Tear the entry
      // down instead; the next syncProjects pass re-establishes it.
      entry.watcher.on("error", () => {
        this.warn(`[performance-snapshot] watcher error for project ${project.id}; unwatching`);
        this.unwatch(project.id);
      });
    } catch {
      return;
    }

    this.entries.set(project.id, entry);
    this.readAndEmit(project.id, snapshotPath);
  }

  unwatch(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher?.close();
    this.entries.delete(projectId);
  }

  dispose(): void {
    for (const projectId of [...this.entries.keys()]) {
      this.unwatch(projectId);
    }
    this.listener = null;
  }

  private scheduleRead(entry: WatcherEntry): void {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      this.readAndEmit(entry.projectId, entry.snapshotPath);
    }, DEBOUNCE_MS);
  }

  private readAndEmit(projectId: string, snapshotPath: string): void {
    if (!existsSync(snapshotPath)) {
      this.listener?.(projectId, null);
      return;
    }

    let contents: string;
    try {
      const { size } = statSync(snapshotPath);
      if (size > MAX_SNAPSHOT_FILE_BYTES) {
        this.warn(
          `[performance-snapshot] ignoring oversized snapshot for project ${projectId} (${size} bytes)`,
        );
        return;
      }
      contents = readFileSync(snapshotPath, "utf8");
    } catch {
      this.warn(`[performance-snapshot] failed to read ${snapshotPath}`);
      return;
    }

    const snapshot = parsePerformanceSnapshotFileContents(contents);
    if (!snapshot) {
      this.warn(`[performance-snapshot] invalid snapshot file for project ${projectId}`);
      return;
    }

    this.listener?.(projectId, snapshot);
  }
}
