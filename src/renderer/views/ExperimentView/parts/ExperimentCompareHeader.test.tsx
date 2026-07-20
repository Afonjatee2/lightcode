import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, Experiment, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ExperimentCompareHeader } from "./ExperimentCompareHeader";

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    getExperimentCandidateStats: () => new Promise<never>(() => {}),
  }),
  isRemoteSession: () => false,
}));

function judgeAgent(kind: string, models: string[]): AgentStatus {
  return {
    kind,
    label: kind,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: models.map((model) => ({ id: model, label: model })),
      efforts: ["low", "high"],
      defaultEffort: "high",
      modelEfforts: {},
      fastModels: models.slice(0, 1),
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: false,
      supportsDirectInput: false,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      settingDefs: [],
      supportsOneShot: true,
    },
  };
}

function makeThread(id: string, status: Thread["status"]): Thread {
  return {
    id,
    projectId: "project-1",
    title: `Thread ${id}`,
    agentKind: "codex",
    config: { model: "model-a" },
    status,
    attention: "none",
    canResumeWithConfig: false,
    groupId: "experiment-1",
    groupName: "Compare candidates",
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

const baseExperiment: Experiment = {
  id: "experiment-1",
  projectId: "project-1",
  title: "Compare candidates",
  prompt: "Implement the change",
  baseBranch: "main",
  baseCommit: "a".repeat(40),
  candidates: [
    {
      threadId: "thread-1",
      agentKind: "codex",
      model: "model-a",
      worktreeBranch: "candidate-a",
      worktreeOwnerToken: "owner-a",
      worktreeState: "owned",
    },
    {
      threadId: "thread-2",
      agentKind: "claude",
      model: "model-b",
      worktreeBranch: "candidate-b",
      worktreeOwnerToken: "owner-b",
      worktreeState: "owned",
    },
  ],
  status: "running",
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

const project = {
  id: "project-1",
  name: "Project",
  location: { kind: "posix" as const, path: "/repo" },
  createdAt: "2026-07-16T00:00:00.000Z",
};

function seedCompareState(experiment: Experiment, threads: Thread[], agents: AgentStatus[] = []) {
  act(() => {
    useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
    useAppStore.setState({ threads, projects: [project], view: { kind: "home" } });
    useAgentStatusesStore.setState({ agentStatuses: agents, wslAgentStatuses: [] });
  });
}

describe("ExperimentCompareHeader", () => {
  afterEach(() => {
    act(() => {
      useExperimentStore.setState({ experiments: {} });
      useAppStore.setState({ threads: [], projects: [], view: { kind: "home" } });
      useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
    });
  });

  it("opens the real judge configuration flow from Crown with AI", () => {
    seedCompareState(
      baseExperiment,
      [makeThread("thread-1", "idle"), makeThread("thread-2", "idle")],
      [judgeAgent("codex", ["gpt-5.5"])],
    );

    render(<ExperimentCompareHeader experimentId={baseExperiment.id} />);

    // The header button is wrapped in a Tooltip.Trigger (itself role=button),
    // so resolve the real <button> through the label text.
    const crownButton = screen.getByText("Crown with AI").closest("button")!;
    expect(crownButton).toBeEnabled();
    fireEvent.click(crownButton);

    // The judge configuration dialog opens in place — no Board round-trip.
    expect(screen.getByRole("heading", { name: "AI judge" })).toBeInTheDocument();
    expect(useAppStore.getState().view).toEqual({ kind: "home" });
  });

  it("opens the saved results view from Results", () => {
    const crowned: Experiment = {
      ...baseExperiment,
      crown: {
        source: "ai",
        threadId: "thread-2",
        createdAt: "2026-07-16T00:00:00.000Z",
        rationale: "Solution 2 is stronger.",
        assessments: [
          { threadId: "thread-1", rationale: "Solution 1 misses coverage." },
          { threadId: "thread-2", rationale: "Solution 2 covers the behavior." },
        ],
      },
    };
    seedCompareState(crowned, [makeThread("thread-1", "idle"), makeThread("thread-2", "idle")]);

    render(<ExperimentCompareHeader experimentId={crowned.id} />);

    fireEvent.click(screen.getByRole("button", { name: "Results" }));

    expect(screen.getByText("We have a winner!")).toBeInTheDocument();
    expect(useAppStore.getState().view).toEqual({ kind: "home" });
  });

  it("returns to the Board from the Board button", () => {
    seedCompareState(baseExperiment, [
      makeThread("thread-1", "working"),
      makeThread("thread-2", "working"),
    ]);

    render(<ExperimentCompareHeader experimentId={baseExperiment.id} />);

    fireEvent.click(screen.getByRole("button", { name: "Board" }));

    expect(useAppStore.getState().view).toEqual({
      kind: "experiment",
      experimentId: baseExperiment.id,
      projectId: baseExperiment.projectId,
    });
  });

  it("does not relaunch candidates or mutate crown state when switching views", () => {
    const crowned: Experiment = {
      ...baseExperiment,
      crown: {
        source: "ai",
        threadId: "thread-2",
        createdAt: "2026-07-16T00:00:00.000Z",
        rationale: "Solution 2 is stronger.",
        assessments: [
          { threadId: "thread-1", rationale: "Solution 1 misses coverage." },
          { threadId: "thread-2", rationale: "Solution 2 covers the behavior." },
        ],
      },
    };
    const threads = [makeThread("thread-1", "idle"), makeThread("thread-2", "idle")];
    seedCompareState(crowned, threads);

    const { unmount } = render(<ExperimentCompareHeader experimentId={crowned.id} />);

    // Board navigates away; returning to Compare must not relaunch anything.
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    unmount();

    const store = useAppStore.getState();
    expect(store.threads).toEqual(threads);
    expect(useExperimentStore.getState().experiments[crowned.id]?.crown).toEqual(crowned.crown);
    expect(useExperimentStore.getState().experiments[crowned.id]?.status).toBe("running");
  });

  it("shows the persistent prompt preview and Ready to review status", () => {
    seedCompareState(baseExperiment, [
      makeThread("thread-1", "idle"),
      makeThread("thread-2", "idle"),
    ]);

    render(<ExperimentCompareHeader experimentId={baseExperiment.id} />);

    expect(screen.getByText("Implement the change")).toBeInTheDocument();
    expect(screen.getByText("Ready to review")).toBeInTheDocument();
  });
});
