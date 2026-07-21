import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Experiment, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ExperimentView } from "./ExperimentView";

const { showGitReviewPanelMock } = vi.hoisted(() => ({
  showGitReviewPanelMock: vi.fn<(projectId: string, worktreePath?: string) => void>(),
}));

vi.mock("@/renderer/actions/panelActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/actions/panelActions")>()),
  showGitReviewPanel: showGitReviewPanelMock,
}));

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

// Crowned candidate (thread-2) carries a worktreePath so the merge dialog's
// Review changes action has a real worktree to open.
const mergeExperiment: Experiment = {
  ...experiment,
  candidates: experiment.candidates.map((candidate) =>
    candidate.threadId === "thread-2"
      ? { ...candidate, worktreePath: "/repo/winner" }
      : candidate,
  ),
};

// Opens the merge confirmation through the crowned card's overflow menu, the
// same path a user takes, and returns the resulting alert dialog.
async function openMergeDialog() {
  fireEvent.click(await screen.findByRole("button", { name: /More actions for candidate 2/ }));
  // The menu item carries a description, so its accessible name is the full
  // text content; match on the leading label rather than an exact string.
  fireEvent.click(await screen.findByRole("menuitem", { name: /Merge winner/ }));
  return screen.findByRole("alertdialog", { name: "Merge experiment winner?" });
}

describe("ExperimentView", () => {
  beforeEach(() => {
    showGitReviewPanelMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      useExperimentStore.setState({ experiments: {} });
      useAppStore.setState({ threads: [] });
    });
  });

  it("migrates generated candidate thread titles to model-first ordering", async () => {
    const thread: Thread = {
      id: "thread-1",
      projectId: experiment.projectId,
      title: "codex · model-a",
      agentKind: "codex",
      config: { model: "model-a" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: false,
      groupId: experiment.id,
      groupName: experiment.title,
      archived: false,
      done: false,
      starred: false,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    act(() => {
      useAppStore.setState({ threads: [thread] });
      useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
    });

    render(<ExperimentView experimentId={experiment.id} />);

    await waitFor(() => expect(useAppStore.getState().threads[0]?.title).toBe("model-a · codex"));
  });

  it("allows discarding while a candidate is running", () => {
    const thread: Thread = {
      id: "thread-1",
      projectId: experiment.projectId,
      title: "model-a · codex",
      agentKind: "codex",
      config: { model: "model-a" },
      status: "working",
      attention: "none",
      canResumeWithConfig: false,
      groupId: experiment.id,
      groupName: experiment.title,
      archived: false,
      done: false,
      starred: false,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    act(() => {
      useAppStore.setState({ threads: [thread] });
      useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
    });

    render(<ExperimentView experimentId={experiment.id} />);

    expect(screen.getByRole("button", { name: "Discard experiment" })).toBeEnabled();
  });

  it("keeps AI judging available while saved results can be reopened", () => {
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    expect(screen.getByText("Crown with AI").closest("button")).toBeInTheDocument();
    const results = screen.getByRole("button", { name: "Results" });
    fireEvent.click(results);

    expect(screen.getByText("We have a winner!")).toBeInTheDocument();
  });

  it("Board is the default view mode", () => {
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    const boardButton = screen.getByText("Board").closest("button");
    expect(boardButton).toHaveAttribute("aria-pressed", "true");
    const compareButton = screen.getByText("Compare").closest("button");
    expect(compareButton).toHaveAttribute("aria-pressed", "false");
  });

  it("shows Completed status when experiment is decided", () => {
    const decidedExperiment = { ...experiment, status: "decided" as const };
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: decidedExperiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows Has errors when a candidate thread has error status", () => {
    const errorThread: Thread = {
      id: "thread-1",
      projectId: experiment.projectId,
      title: "model-a · codex",
      agentKind: "codex",
      config: { model: "model-a" },
      status: "error",
      attention: "none",
      canResumeWithConfig: false,
      groupId: experiment.id,
      groupName: experiment.title,
      archived: false,
      done: false,
      starred: false,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const runningExperiment = { ...experiment, status: "running" as const, crown: undefined };
    act(() => {
      useAppStore.setState({ threads: [errorThread] });
      useExperimentStore.setState({ experiments: { [experiment.id]: runningExperiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    expect(screen.getByText("Has errors")).toBeInTheDocument();
  });

  it("shows the external verdict badge only on the externally crowned candidate", () => {
    const externalCrownExperiment = {
      ...experiment,
      crown: {
        source: "external" as const,
        threadId: "thread-1",
        verdict: "approve" as const,
        note: "Looks solid",
        createdAt: "2026-07-16T00:00:00.000Z",
      },
    };
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: externalCrownExperiment } });
    });

    render(<ExperimentView experimentId={experiment.id} />);

    // Exercise ExperimentView's real gate (crown.source === "external" &&
    // crown.threadId === candidate.threadId), not a manually passed prop.
    const cardA = screen.getByRole("button", { name: "Open candidate 1" }).closest(".group");
    const cardB = screen.getByRole("button", { name: "Open candidate 2" }).closest(".group");
    expect(cardA).not.toBeNull();
    expect(cardB).not.toBeNull();
    expect(within(cardA as HTMLElement).getByText("Approved externally")).toBeInTheDocument();
    expect(within(cardA as HTMLElement).getByText("Looks solid")).toBeInTheDocument();
    expect(
      within(cardB as HTMLElement).queryByText("Approved externally"),
    ).not.toBeInTheDocument();
    expect(within(cardB as HTMLElement).queryByText("Changes requested")).not.toBeInTheDocument();
  });

  it("disables Merge winner until the review acknowledgment is checked", async () => {
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: mergeExperiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    const dialog = await openMergeDialog();
    const confirm = within(dialog).getByRole("button", { name: "Merge winner" });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("checkbox", { name: "I reviewed these changes" }));

    expect(confirm).toBeEnabled();
  });

  it("opens the git review panel for the crowned worktree from Review changes", async () => {
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: mergeExperiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    const dialog = await openMergeDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review changes" }));

    expect(showGitReviewPanelMock).toHaveBeenCalledWith("project-1", "/repo/winner");
    // Review changes must close the merge dialog first, otherwise HeroUI's
    // modal backdrop/focus-trap blocks interaction with the review panel.
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: "Merge experiment winner?" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("resolves the review worktree from the crowned thread when the candidate has no path", async () => {
    const crownedThread: Thread = {
      id: "thread-2",
      projectId: experiment.projectId,
      title: "model-b · claude",
      agentKind: "claude",
      config: { model: "model-b" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: false,
      groupId: experiment.id,
      groupName: experiment.title,
      worktreePath: "/repo/thread-winner",
      archived: false,
      done: false,
      starred: false,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    act(() => {
      useAppStore.setState({ threads: [crownedThread] });
      // The base experiment's crowned candidate (thread-2) carries no
      // worktreePath, so the review path must fall back to the thread's.
      useExperimentStore.setState({ experiments: { [experiment.id]: experiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    const dialog = await openMergeDialog();
    const review = within(dialog).getByRole("button", { name: "Review changes" });
    expect(review).toBeEnabled();
    fireEvent.click(review);

    expect(showGitReviewPanelMock).toHaveBeenCalledWith("project-1", "/repo/thread-winner");
  });

  it("resets the review acknowledgment when the merge dialog is reopened", async () => {
    act(() => {
      useExperimentStore.setState({ experiments: { [experiment.id]: mergeExperiment } });
    });
    render(<ExperimentView experimentId={experiment.id} />);

    let dialog = await openMergeDialog();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "I reviewed these changes" }));
    expect(within(dialog).getByRole("button", { name: "Merge winner" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: "Merge experiment winner?" }),
      ).not.toBeInTheDocument(),
    );

    dialog = await openMergeDialog();
    expect(
      within(dialog).getByRole("checkbox", { name: "I reviewed these changes" }),
    ).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Merge winner" })).toBeDisabled();
  });
});
