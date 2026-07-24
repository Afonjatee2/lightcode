import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGitStore } from "@/renderer/state/gitStore";
import type { GitStatusResult, PrData, Project, Thread } from "@/shared/contracts";
import type { RemoteThreadGitSummary } from "@/shared/remote";
import { useGitSummariesStore } from "./gitSummaries";
import { useGitSummaryHydration } from "./useGitSummaryHydration";

const bridge = vi.hoisted(() => ({
  getGitStatus: vi.fn<(payload: unknown) => Promise<GitStatusResult>>(),
  ghGetPrForBranch: vi.fn<(payload: unknown) => Promise<PrData | null>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

function makeProject(): Project {
  return {
    id: "project-1",
    name: "poracode",
    location: { kind: "posix", path: "/repo/poracode" },
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Hi",
    agentKind: "claude",
    config: {},
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as Thread;
}

function makeStatus(branch: string): GitStatusResult {
  return {
    isRepo: true,
    branch,
    tracking: `origin/${branch}`,
    hasRemote: true,
    remoteInfo: null,
    ahead: 1,
    behind: 2,
    staged: [],
    unstaged: [],
    totalInsertions: 3,
    totalDeletions: 4,
  };
}

function makeSummary(branch: string): RemoteThreadGitSummary {
  return {
    isRepo: true,
    branch,
    totalInsertions: 0,
    totalDeletions: 0,
    ahead: 0,
    behind: 0,
    pr: null,
  };
}

function makePr(overrides: Partial<PrData> = {}): PrData {
  return {
    number: 42,
    state: "open",
    title: "Fix mobile PR status",
    url: "https://github.test/repo/pull/42",
    baseBranch: "main",
    isDraft: false,
    checksStatus: "SUCCESS",
    updatedAt: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

describe("useGitSummaryHydration", () => {
  beforeEach(() => {
    bridge.getGitStatus.mockReset();
    bridge.ghGetPrForBranch.mockReset();
    bridge.ghGetPrForBranch.mockResolvedValue(null);
    useGitSummariesStore.getState().reset();
    useGitStore.setState({ statuses: {}, worktreeStatuses: {}, prData: {} });
  });

  it("hydrates a missing thread git summary from the remote bridge", async () => {
    const project = makeProject();
    const thread = makeThread();
    bridge.getGitStatus.mockResolvedValue(makeStatus("feature/mobile"));

    renderHook(() => useGitSummaryHydration(thread, project));

    await waitFor(() => {
      expect(useGitSummariesStore.getState().byThread[thread.id]?.branch).toBe("feature/mobile");
    });
    expect(bridge.getGitStatus).toHaveBeenCalledWith({ projectLocation: project.location });
    expect(useGitStore.getState().statuses[project.id]?.branch).toBe("feature/mobile");
  });

  it("keeps local fallbacks when desktop summaries omit the thread", () => {
    useGitSummariesStore.getState().setThread("thread-1", makeSummary("local"));

    useGitSummariesStore.getState().setAll({});

    expect(useGitSummariesStore.getState().byThread["thread-1"]?.branch).toBe("local");
  });

  it("prefers desktop summaries over local fallbacks when both exist", () => {
    useGitSummariesStore.getState().setThread("thread-1", makeSummary("local"));

    useGitSummariesStore.getState().setAll({ "thread-1": makeSummary("desktop") });

    expect(useGitSummariesStore.getState().byThread["thread-1"]?.branch).toBe("desktop");
  });

  it("preserves unchanged remote summary identities", () => {
    useGitSummariesStore.getState().setAll({ "thread-1": makeSummary("desktop") });
    const before = useGitSummariesStore.getState();

    useGitSummariesStore.getState().setAll({ "thread-1": makeSummary("desktop") });
    const after = useGitSummariesStore.getState();

    expect(after).toBe(before);
    expect(after.remoteByThread).toBe(before.remoteByThread);
    expect(after.byThread).toBe(before.byThread);
    expect(after.byThread["thread-1"]).toBe(before.byThread["thread-1"]);
  });

  it("refreshes a streamed worktree PR into the full git cache and its mobile badge", async () => {
    const project = makeProject();
    const worktreePath = "/repo/.poracode/worktrees/mobile";
    const thread = makeThread({
      worktreePath,
      worktreeBranch: "feature/mobile",
      prNumber: 42,
    });
    const staleSummary: RemoteThreadGitSummary = {
      ...makeSummary("feature/mobile"),
      pr: {
        number: 42,
        state: "open",
        title: "Old title",
        url: "https://github.test/repo/pull/42",
        isDraft: false,
        checksStatus: "FAILURE",
      },
    };
    const latestPr = makePr();
    bridge.ghGetPrForBranch.mockResolvedValue(latestPr);
    useGitSummariesStore.getState().setAll({ [thread.id]: staleSummary });

    renderHook(() => useGitSummaryHydration(thread, project));

    await waitFor(() => {
      expect(useGitStore.getState().prData[worktreePath]).toEqual(latestPr);
    });
    expect(bridge.ghGetPrForBranch).toHaveBeenCalledWith({
      projectLocation: project.location,
      branch: "feature/mobile",
    });
    expect(useGitStore.getState().ghAvailable[project.id]).toBe(true);
    expect(useGitSummariesStore.getState().byThread[thread.id]?.pr).toMatchObject({
      number: 42,
      title: "Fix mobile PR status",
      checksStatus: "SUCCESS",
    });
  });
});
