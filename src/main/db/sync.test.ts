import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { closeDatabase, initDatabase, markProjectIdsKnown, markThreadIdsKnown } from "./connection";
import { dbGetProject, dbGetProjects, dbGetThreads, dbUpsertProject, dbUpsertThread } from "./projectsThreads";
import { dbSyncAll } from "./sync";

// node_modules/better-sqlite3 may be compiled for Electron's ABI. Fall back to
// the Node-ABI binding used by the headless server, preparing it on demand so
// these real-database tests never silently skip on Electron development installs.
const serverNativeBinding = join(process.cwd(), "dist", "server-native", "better_sqlite3.node");
let nativeBindingEnv: string | undefined;

function databaseOpens(nativeBinding?: string): boolean {
  if (nativeBinding && !existsSync(nativeBinding)) return false;
  try {
    const database = nativeBinding
      ? new Database(":memory:", { nativeBinding })
      : new Database(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
}

if (!databaseOpens()) {
  if (!databaseOpens(serverNativeBinding)) {
    execFileSync(process.execPath, [join(process.cwd(), "scripts", "prepare-server-native.mjs")], {
      stdio: "inherit",
    });
  }
  if (!databaseOpens(serverNativeBinding)) {
    throw new Error("Unable to prepare a Node-compatible better-sqlite3 binding for tests.");
  }
  nativeBindingEnv = serverNativeBinding;
}

function testThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Test thread",
    agentKind: "claude",
    config: { model: "sonnet" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dbSyncAll vs. direct dbUpsertProject/dbUpsertThread writes", () => {
  let dir: string;

  beforeEach(() => {
    if (nativeBindingEnv) {
      process.env.PORACODE_BETTER_SQLITE3_NATIVE_BINDING = nativeBindingEnv;
    }
    dir = mkdtempSync(join(tmpdir(), "lc-db-sync-test-"));
    initDatabase(join(dir, "state.sqlite"));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.PORACODE_BETTER_SQLITE3_NATIVE_BINDING;
  });

  it("does not delete a project written directly while the renderer's snapshot is still stale", () => {
    // Simulates: home-scope bootstrap / orchestrator / a remote command (or a
    // test harness) writes a brand-new project directly, bypassing the
    // renderer's store. The renderer's store never learned about it, so its
    // next unrelated persist (e.g. a view change) still reflects the OLD,
    // stale project list — exactly the state that crashed the Phase 4 smoke
    // acceptance test with a FOREIGN KEY constraint failure.
    dbUpsertProject(
      {
        id: "external-project",
        name: "Externally created project",
        location: { kind: "posix", path: "/tmp/external-project" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      0,
    );

    // The renderer persists its stale snapshot (no knowledge of "external-project").
    dbSyncAll([], [], JSON.stringify({ kind: "home" }));

    expect(dbGetProject("external-project")).not.toBeNull();

    // The subsequent direct thread write (referencing the project) must not
    // hit a FOREIGN KEY violation — this reproduces the exact smoke-test crash.
    expect(() =>
      dbUpsertThread(testThread({ id: "external-thread", projectId: "external-project" }), 0),
    ).not.toThrow();
  });

  it("still deletes a project once the renderer has actually seen it and later omits it", () => {
    dbUpsertProject(
      {
        id: "project-1",
        name: "Test project",
        location: { kind: "posix", path: "/tmp/project" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      0,
    );

    // The renderer hydrates from DB (this is what the `dbGetProjects` IPC
    // handler does on every call, marking ids "known").
    markProjectIdsKnown(dbGetProjects().map((project) => project.id));

    // The user removes the project in the UI; the store's next persist omits it.
    dbSyncAll([], [], JSON.stringify({ kind: "home" }));

    expect(dbGetProject("project-1")).toBeNull();
  });

  it("does not delete a thread written directly before the renderer's store knows about it", () => {
    dbUpsertProject(
      {
        id: "project-1",
        name: "Test project",
        location: { kind: "posix", path: "/tmp/project" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      0,
    );
    markProjectIdsKnown(["project-1"]);

    // e.g. the orchestrator bridge creating a child thread directly.
    dbUpsertThread(testThread({ id: "orchestrator-child" }), 0);

    // A totally unrelated renderer persist lands before the renderer learns
    // about the new child thread.
    dbSyncAll([dbGetProject("project-1")!], [], JSON.stringify({ kind: "home" }));

    const ids = dbGetThreads().map((thread) => thread.id);
    expect(ids).toContain("orchestrator-child");
  });

  it("still deletes a thread once the renderer has seen it and later omits it", () => {
    dbUpsertProject(
      {
        id: "project-1",
        name: "Test project",
        location: { kind: "posix", path: "/tmp/project" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      0,
    );
    markProjectIdsKnown(["project-1"]);
    dbUpsertThread(testThread(), 0);
    markThreadIdsKnown(dbGetThreads().map((thread) => thread.id));

    dbSyncAll([dbGetProject("project-1")!], [], JSON.stringify({ kind: "home" }));

    expect(dbGetThreads()).toHaveLength(0);
  });
});
