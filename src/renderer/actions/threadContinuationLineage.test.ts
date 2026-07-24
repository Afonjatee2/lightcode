import { describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import {
  buildOrchestratorChildSeed,
  resolveContinuationLineage,
} from "./threadContinuationLineage";

function makeThread(input: Partial<Thread> & Pick<Thread, "id" | "title">): Thread {
  return {
    projectId: "project-1",
    agentKind: "codex",
    config: { model: "gpt-5.6-sol" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    ...input,
  };
}

describe("resolveContinuationLineage", () => {
  it.each([false, true])(
    "keeps a Swarm replacement owned by its orchestrator when closeOriginal=%s",
    (closeOriginal) => {
      const root = makeThread({
        id: "root",
        title: "Swarm · Build feature",
        groupId: "root",
        groupName: "Swarm · Build feature",
      });
      const worker = makeThread({
        id: "worker",
        title: "Implement chart",
        parentThreadId: root.id,
        groupId: root.groupId,
        groupName: root.groupName,
      });

      expect(resolveContinuationLineage(worker, closeOriginal, [root, worker])).toEqual({
        threadMetadata: {
          parentThreadId: root.id,
          groupId: root.groupId,
          groupName: root.groupName,
        },
      });
    },
  );

  it("recovers missing Swarm group metadata from the orchestrator", () => {
    const root = makeThread({ id: "root", title: "Swarm root", groupId: "swarm-group" });
    const worker = makeThread({
      id: "worker",
      title: "Worker",
      parentThreadId: root.id,
    });

    expect(resolveContinuationLineage(worker, true, [root, worker])).toEqual({
      threadMetadata: {
        parentThreadId: root.id,
        groupId: "swarm-group",
        groupName: "Swarm root",
      },
      sourceGroupPatch: { groupId: "swarm-group", groupName: "Swarm root" },
    });
  });

  it("keeps standalone move behavior ungrouped", () => {
    const source = makeThread({ id: "source", title: "Standalone" });
    expect(resolveContinuationLineage(source, true, [source])).toEqual({ threadMetadata: {} });
  });

  it("creates a group for a regular fork", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "new-group" });
    const source = makeThread({ id: "source", title: "Standalone" });

    expect(resolveContinuationLineage(source, false, [source])).toEqual({
      threadMetadata: { groupId: "new-group", groupName: "Standalone" },
      sourceGroupPatch: { groupId: "new-group", groupName: "Standalone" },
    });
    vi.unstubAllGlobals();
  });
});

describe("buildOrchestratorChildSeed", () => {
  it("builds a live registry seed for a replacement worker", () => {
    const replacement = makeThread({
      id: "replacement",
      title: "Continue chart work",
      agentKind: "qwen",
      parentThreadId: "root",
      worktreePath: "/repo/.worktrees/chart",
      worktreeBranch: "swarm/chart",
    });

    expect(buildOrchestratorChildSeed(replacement)).toEqual({
      threadId: replacement.id,
      parentThreadId: "root",
      agentKind: "qwen",
      title: replacement.title,
      worktreePath: replacement.worktreePath,
      worktreeBranch: replacement.worktreeBranch,
      createdAt: replacement.createdAt,
    });
  });
});
