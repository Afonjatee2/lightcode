import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Experiment, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    getExperimentCandidateStats: () => new Promise<never>(() => {}),
  }),
}));

vi.mock("@/renderer/views/HomeView", () => ({
  HomeView: () => <div data-testid="home-view" />,
}));

vi.mock("@/renderer/components/thread/ThreadDraftView", () => ({
  ThreadDraftView: () => <div data-testid="draft-view" />,
}));

vi.mock("@/renderer/views/MainView/parts/AppContent/parts/ThreadPane", () => ({
  ThreadPane: (props: { threadId: string }) => (
    <div data-testid={`thread-pane-${props.threadId}`} />
  ),
}));

vi.mock("@/renderer/views/MainView/parts/AppContent/parts/DraftPane", () => ({
  DraftPane: (props: { paneId: string }) => <div data-testid={`draft-pane-${props.paneId}`} />,
}));

vi.mock("@/renderer/components/layout/SplitPaneContainer", () => ({
  resolvePaneDomKey: (input: { paneId: string }) => input.paneId,
  SplitPaneContainer: (props: {
    layout: unknown;
    renderPane: (paneId: string, rect: unknown) => React.ReactNode;
  }) => {
    function collectPaneIds(node: unknown): string[] {
      if (!node || typeof node !== "object") return [];
      const layout = node as { kind: string; paneId?: string; children?: unknown[] };
      if (layout.kind === "leaf") return layout.paneId ? [layout.paneId] : [];
      return (layout.children ?? []).flatMap(collectPaneIds);
    }
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    return (
      <div data-testid="split-pane-container">
        {collectPaneIds(props.layout).map((paneId) => (
          <div key={paneId}>{props.renderPane(paneId, rect)}</div>
        ))}
      </div>
    );
  },
}));

import { AppContent } from "./AppContent";

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

const experiment: Experiment = {
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
  status: "running",
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

describe("AppContent experiment compare integration", () => {
  afterEach(() => {
    act(() => {
      useExperimentStore.setState({ experiments: {} });
      useAppStore.setState({ threads: [], projects: [], view: { kind: "home" } });
    });
  });

  it("renders ExperimentCompareHeader for an active experiment group", () => {
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
      useAppStore.setState({
        threads: [makeThread("thread-1", "idle"), makeThread("thread-2", "idle")],
        view: {
          kind: "thread",
          panes: ["thread-1", "thread-2"],
          activeGroupId: experiment.id,
        },
      });
    });

    render(<AppContent />);

    // Compare header chrome (title, prompt preview, view switcher) is present…
    expect(screen.getByText("Compare candidates")).toBeInTheDocument();
    expect(screen.getByText("Implement the change")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Results" })).toBeInTheDocument();
    // …and the candidate panes still render underneath it.
    expect(screen.getByTestId("thread-pane-thread-1")).toBeInTheDocument();
    expect(screen.getByTestId("thread-pane-thread-2")).toBeInTheDocument();
  });

  it("keeps compare header actions wired to their real behaviour", () => {
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
      useAppStore.setState({
        threads: [makeThread("thread-1", "idle"), makeThread("thread-2", "idle")],
        view: {
          kind: "thread",
          panes: ["thread-1", "thread-2"],
          activeGroupId: experiment.id,
        },
      });
    });

    render(<AppContent />);

    // Results opens the saved judge results directly from the compare grid.
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(screen.getByText("We have a winner!")).toBeInTheDocument();

    // Close the results dialog — content behind an open modal is inert.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Board returns to the experiment board view.
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(useAppStore.getState().view).toEqual({
      kind: "experiment",
      experimentId: experiment.id,
      projectId: experiment.projectId,
    });
  });
});
