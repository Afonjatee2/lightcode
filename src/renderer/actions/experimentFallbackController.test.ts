import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Experiment, Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  __resetExperimentFallbackState,
  maybeAdvanceExperimentFallback,
} from "./experimentFallbackController";

const mocks = vi.hoisted(() => ({
  bridge: {
    closeThread: vi.fn<(payload: unknown) => Promise<void>>(),
  },
  performInitialThreadLaunch: vi.fn<(input: unknown) => Promise<void>>(),
  closeExperimentThread: vi.fn<(threadId: string) => Promise<boolean>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => mocks.bridge,
}));
vi.mock("./threadLaunchActions", () => ({
  performInitialThreadLaunch: mocks.performInitialThreadLaunch,
}));
vi.mock("./experimentWorktreeActions", () => ({
  closeExperimentThread: mocks.closeExperimentThread,
}));

const project: Project = {
  id: "project-1",
  name: "Project",
  location: { kind: "posix", path: "/repo" },
  scripts: { actions: [] },
  createdAt: "2026-07-13T00:00:00.000Z",
};

function agentStatus(
  kind: string,
  overrides: Partial<AgentStatus> = {},
): AgentStatus {
  return {
    kind,
    label: kind,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [{ id: `${kind}-model`, label: `${kind} Model` }],
      efforts: ["low"],
      modelEfforts: {},
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsOneShot: true,
      supportsDirectInput: false,
      supportsResume: false,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      settingDefs: [],
    },
    ...overrides,
  };
}

function experiment(
  overrides: Partial<Experiment> = {},
): Experiment {
  return {
    id: "experiment-1",
    projectId: project.id,
    title: "Experiment",
    prompt: "Implement it",
    baseBranch: "main",
    baseCommit: "a".repeat(40),
    candidates: [
      {
        threadId: "thread-1",
        agentKind: "claude",
        model: "claude-fable-5",
        worktreePath: "/repo/one",
        worktreeBranch: "poracode/one",
        worktreeOwnerToken: "experiment-1:thread-1",
        worktreeState: "owned",
        fallbackChain: ["codex", "gemini"],
      },
    ],
    status: "running",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: project.id,
    title: "Thread 1",
    agentKind: "claude",
    config: { model: "claude-fable-5" },
    status: "error",
    attention: "error",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    worktreePath: "/repo/one",
    worktreeBranch: "poracode/one",
    groupId: "experiment-1",
    groupName: "Experiment",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("experimentFallbackController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetExperimentFallbackState();
    useAppStore.setState({ projects: [project], threads: [thread()], view: { kind: "home" } });
    useAgentStatusesStore.setState({
      agentStatuses: [agentStatus("codex"), agentStatus("gemini")],
      wslAgentStatuses: [],
    });
    useSharedSettings.setState({ disabledAgents: [] });
    useExperimentStore.setState({ experiments: {} });
    (mocks.bridge.closeThread as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (mocks.performInitialThreadLaunch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (mocks.closeExperimentThread as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it("advances to the next agent after an error", async () => {
    useExperimentStore.getState().addExperiment(experiment());
    useAppStore.setState({ threads: [thread()] });

    const result = maybeAdvanceExperimentFallback("thread-1");
    await result;

    expect(mocks.closeExperimentThread).toHaveBeenCalledWith("thread-1");

    const updatedThread = useAppStore.getState().threads.find((t) => t.id === "thread-1");
    expect(updatedThread?.agentKind).toBe("codex");
    expect(updatedThread?.config.model).toBe("codex-model");

    const updatedExperiment =
      useExperimentStore.getState().experiments["experiment-1"];
    const updatedCandidate = updatedExperiment?.candidates.find(
      (c) => c.threadId === "thread-1",
    );
    expect(updatedCandidate?.agentKind).toBe("codex");
    expect(updatedCandidate?.model).toBeUndefined();

    expect(mocks.performInitialThreadLaunch).toHaveBeenCalledTimes(1);
  });

  it("respects the hard cap: does not advance past chain length", async () => {
    const exp = experiment({
      candidates: [
        {
          threadId: "thread-1",
          agentKind: "claude",
          worktreePath: "/repo/one",
          worktreeBranch: "poracode/one",
          worktreeOwnerToken: "experiment-1:thread-1",
          worktreeState: "owned",
          fallbackChain: ["codex"],
        },
      ],
    });
    useExperimentStore.getState().addExperiment(exp);

    await maybeAdvanceExperimentFallback("thread-1");
    // first advance consumed the only fallback agent
    const result2 = maybeAdvanceExperimentFallback("thread-1");
    await result2;
    // should not have launched twice
    expect(mocks.performInitialThreadLaunch).toHaveBeenCalledTimes(1);
  });

  it("skips non-owned candidates (no worktree)", () => {
    const exp = experiment({
      candidates: [
        {
          threadId: "thread-1",
          agentKind: "claude",
          worktreeBranch: "poracode/one",
          worktreeOwnerToken: "experiment-1:thread-1",
          worktreeState: "pending",
          fallbackChain: ["codex"],
        },
      ],
    });
    useExperimentStore.getState().addExperiment(exp);

    maybeAdvanceExperimentFallback("thread-1");
    expect(mocks.closeExperimentThread).not.toHaveBeenCalled();
  });

  it("skips owned candidates missing worktreePath", () => {
    const exp = experiment({
      candidates: [
        {
          threadId: "thread-1",
          agentKind: "claude",
          worktreeBranch: "poracode/one",
          worktreeOwnerToken: "experiment-1:thread-1",
          worktreeState: "owned",
          fallbackChain: ["codex"],
        },
      ],
    });
    useExperimentStore.getState().addExperiment(exp);

    maybeAdvanceExperimentFallback("thread-1");
    expect(mocks.closeExperimentThread).not.toHaveBeenCalled();
  });

  it("honors disabledAgents — skips disabled agents in the chain", async () => {
    useSharedSettings.setState({ disabledAgents: ["codex"] });
    useExperimentStore.getState().addExperiment(
      experiment({
        candidates: [
          {
            threadId: "thread-1",
            agentKind: "claude",
            model: "claude-fable-5",
            worktreePath: "/repo/one",
            worktreeBranch: "poracode/one",
            worktreeOwnerToken: "experiment-1:thread-1",
            worktreeState: "owned",
            fallbackChain: ["codex", "gemini"],
          },
        ],
      }),
    );

    await maybeAdvanceExperimentFallback("thread-1");

    const updatedThread = useAppStore.getState().threads.find((t) => t.id === "thread-1");
    expect(updatedThread?.agentKind).toBe("gemini");
  });

  it("no-op when there is no fallback chain", () => {
    const exp = experiment({
      candidates: [
        {
          threadId: "thread-1",
          agentKind: "claude",
          worktreePath: "/repo/one",
          worktreeBranch: "poracode/one",
          worktreeOwnerToken: "experiment-1:thread-1",
          worktreeState: "owned",
        },
      ],
    });
    useExperimentStore.getState().addExperiment(exp);

    maybeAdvanceExperimentFallback("thread-1");
    expect(mocks.closeExperimentThread).not.toHaveBeenCalled();
  });

  it("no-op when the chain is exhausted (all disabled)", () => {
    useSharedSettings.setState({ disabledAgents: ["codex", "gemini"] });
    useExperimentStore.getState().addExperiment(experiment());

    maybeAdvanceExperimentFallback("thread-1");
    expect(mocks.closeExperimentThread).not.toHaveBeenCalled();
  });

  it("guards against re-entrant calls for the same threadId", async () => {
    useExperimentStore.getState().addExperiment(experiment());
    // Don't await — trigger re-entrancy
    void maybeAdvanceExperimentFallback("thread-1");
    const result2 = maybeAdvanceExperimentFallback("thread-1");
    expect(result2).toBeUndefined();
  });

  it("bails out when closeExperimentThread fails, but cursor still advances", async () => {
    (mocks.closeExperimentThread as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    useExperimentStore.getState().addExperiment(experiment());

    await maybeAdvanceExperimentFallback("thread-1");

    expect(mocks.closeExperimentThread).toHaveBeenCalledWith("thread-1");
    expect(mocks.performInitialThreadLaunch).not.toHaveBeenCalled();

    // Cursor advanced — a second call tries the next agent
    (mocks.closeExperimentThread as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await maybeAdvanceExperimentFallback("thread-1");

    const updatedThread = useAppStore.getState().threads.find((t) => t.id === "thread-1");
    expect(updatedThread?.agentKind).toBe("gemini");
    expect(mocks.performInitialThreadLaunch).toHaveBeenCalledTimes(1);
  });

  it("no-op when experiment is not running (decided)", () => {
    useExperimentStore.getState().addExperiment(
      experiment({ status: "decided" }),
    );

    maybeAdvanceExperimentFallback("thread-1");
    expect(mocks.closeExperimentThread).not.toHaveBeenCalled();
  });
});
