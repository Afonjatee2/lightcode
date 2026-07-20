import type { ComponentProps } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentCandidate,
  GetExperimentCandidateStatsResult,
  Thread,
} from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ExperimentCandidateCard } from "./ExperimentCandidateCard";

const { statsMock, showGitReviewPanelMock } = vi.hoisted(() => ({
  statsMock: vi.fn<() => Promise<GetExperimentCandidateStatsResult>>(),
  showGitReviewPanelMock: vi.fn<(projectId: string, worktreePath: string) => void>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    getExperimentCandidateStats: statsMock,
  }),
}));

vi.mock("@/renderer/actions/panelActions", () => ({
  showGitReviewPanel: showGitReviewPanelMock,
}));

const candidate: ExperimentCandidate = {
  threadId: "thread-1",
  agentKind: "codex",
  agentLabel: "Codex",
  model: "gpt-5",
  worktreeBranch: "candidate-one",
  worktreeOwnerToken: "owner-one",
  worktreeState: "owned",
};

const thread: Thread = {
  id: candidate.threadId,
  projectId: "project-1",
  title: "Candidate",
  agentKind: "codex",
  config: { model: "gpt-5" },
  status: "idle",
  attention: "none",
  canResumeWithConfig: false,
  worktreePath: "/repo/one",
  worktreeBranch: candidate.worktreeBranch,
  prNumber: 328,
  archived: false,
  done: false,
  starred: false,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

const project = {
  id: "project-1",
  name: "Project",
  location: { kind: "posix" as const, path: "/repo" },
  createdAt: "2026-07-16T00:00:00.000Z",
};

function renderCard(overrides: Partial<ComponentProps<typeof ExperimentCandidateCard>> = {}) {
  const onOpen = vi.fn<() => void>();
  const onCrown = vi.fn<() => void>();
  const onMerge = vi.fn<() => void>();
  const onCreatePr = vi.fn<() => void>();
  const view = render(
    <ExperimentCandidateCard
      candidate={candidate}
      candidateNumber={1}
      baseCommit={"a".repeat(40)}
      configLabel="GPT-5"
      isCrowned
      isWinner={false}
      decided={false}
      operationLocked={false}
      hasActiveCandidate={false}
      isCreatingPr={false}
      isMerging={false}
      onOpen={onOpen}
      onCrown={onCrown}
      onMerge={onMerge}
      onCreatePr={onCreatePr}
      {...overrides}
    />,
  );
  return { view, onOpen, onCrown, onMerge, onCreatePr };
}

describe("ExperimentCandidateCard", () => {
  beforeEach(() => {
    statsMock.mockReset();
    statsMock.mockImplementation(() => new Promise<never>(() => {}));
    showGitReviewPanelMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      useAppStore.setState({ threads: [], projects: [] });
      useGitStore.setState({ prData: {} });
    });
  });

  it("shows the model configuration as the primary label and provider as secondary", () => {
    renderCard();

    expect(screen.getByRole("button", { name: "Open candidate 1: GPT-5" })).toBeInTheDocument();
    expect(screen.getByText("Codex").parentElement).toHaveClass("text-muted");
  });

  it("shows progress while creating a pull request or merging the winner", () => {
    const { view } = renderCard({ isCreatingPr: true });

    expect(
      screen.getByText("Create PR").closest("button")?.querySelector(".animate-spin"),
    ).not.toBe(null);

    view.rerender(
      <ExperimentCandidateCard
        candidate={candidate}
        candidateNumber={1}
        baseCommit={"a".repeat(40)}
        configLabel="GPT-5"
        isCrowned
        isWinner={false}
        decided={false}
        operationLocked
        hasActiveCandidate={false}
        isCreatingPr={false}
        isMerging
        onOpen={vi.fn<() => void>()}
        onCrown={vi.fn<() => void>()}
        onMerge={vi.fn<() => void>()}
        onCreatePr={vi.fn<() => void>()}
      />,
    );

    expect(
      screen.getByText("Merge winner").closest("button")?.querySelector(".animate-spin"),
    ).not.toBe(null);
  });

  it("replaces Create PR with the existing pull request status icon", () => {
    act(() => {
      useAppStore.setState({ threads: [thread] });
      useGitStore.setState({
        prData: {
          "/repo/one": {
            number: 328,
            state: "open",
            title: "Candidate pull request",
            url: "https://example.com/pull/328",
            baseBranch: "main",
            isDraft: false,
            checksStatus: "FAILURE",
            updatedAt: "2026-07-16T00:00:00.000Z",
          },
        },
      });
    });

    renderCard();

    expect(screen.queryByText("Create PR")).not.toBeInTheDocument();
    const prButton = screen.getByRole("button", { name: "Open PR #328" });
    expect(prButton.querySelector(".lucide-git-pull-request")).toHaveClass("text-danger");
  });

  it("shows Running badge when thread is working", () => {
    const workingThread = { ...thread, status: "working" as const };
    act(() => {
      useAppStore.setState({ threads: [workingThread], projects: [project] });
    });
    renderCard({ isCrowned: false });
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows Failed badge when thread has error status", () => {
    const errorThread = { ...thread, status: "error" as const };
    act(() => {
      useAppStore.setState({ threads: [errorThread], projects: [project] });
    });
    renderCard({ isCrowned: false });
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows Queued badge when thread is launching", () => {
    const launchingThread = { ...thread, status: "launching" as const };
    act(() => {
      useAppStore.setState({ threads: [launchingThread], projects: [project] });
    });
    renderCard({ isCrowned: false });
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });

  it("does not label needs_reply or needs_approval threads as Queued", () => {
    for (const status of ["needs_reply", "needs_approval"] as const) {
      const waitingThread = { ...thread, status };
      act(() => {
        useAppStore.setState({ threads: [waitingThread], projects: [project] });
      });
      const { view } = renderCard({ isCrowned: false });
      expect(screen.getByText("Running")).toBeInTheDocument();
      expect(screen.queryByText("Queued")).not.toBeInTheDocument();
      view.unmount();
      act(() => {
        useAppStore.setState({ threads: [] });
      });
    }
  });

  it("renders the visible candidate number", () => {
    renderCard({ candidateNumber: 2, isCrowned: false });

    expect(screen.getByLabelText("Candidate 2")).toHaveTextContent("#2");
  });

  it("opens the candidate from the visible Open action", () => {
    const { onOpen } = renderCard({ isCrowned: false });

    fireEvent.click(screen.getByRole("button", { name: "Open candidate 1" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("invokes the Git review panel from Review changes when changes exist", async () => {
    statsMock.mockResolvedValue({ insertions: 12, deletions: 3, files: 2 });
    const reviewThread = { ...thread, worktreePath: "/repo/review" };
    act(() => {
      useAppStore.setState({ threads: [reviewThread], projects: [project] });
    });
    renderCard({ isCrowned: false });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Review candidate 1 changes" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review candidate 1 changes" }));

    expect(showGitReviewPanelMock).toHaveBeenCalledWith("project-1", "/repo/review");
  });

  it("disables Review changes while there are no reviewable changes", async () => {
    statsMock.mockResolvedValue({ insertions: 0, deletions: 0, files: 0 });
    const noChangesThread = { ...thread, worktreePath: "/repo/no-changes" };
    act(() => {
      useAppStore.setState({ threads: [noChangesThread], projects: [project] });
    });
    renderCard({ isCrowned: false });

    await waitFor(() => expect(screen.getByText("Completed · no changes")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Review candidate 1 changes" })).toBeDisabled();
    expect(showGitReviewPanelMock).not.toHaveBeenCalled();
  });

  it("disables Review changes when the worktree is unavailable", () => {
    const removedCandidate: ExperimentCandidate = {
      ...candidate,
      worktreeState: "removed",
    };
    const { worktreePath: _ignored, ...removedThread } = thread;
    act(() => {
      useAppStore.setState({ threads: [removedThread], projects: [project] });
    });
    renderCard({ candidate: removedCandidate, isCrowned: false });

    expect(screen.getByRole("button", { name: "Review candidate 1 changes" })).toBeDisabled();
    expect(screen.getByText("Worktree removed")).toBeInTheDocument();
  });

  it("words the completed candidate with no changes correctly", async () => {
    statsMock.mockResolvedValue({ insertions: 0, deletions: 0, files: 0 });
    const doneThread = { ...thread, status: "idle" as const, worktreePath: "/repo/done" };
    act(() => {
      useAppStore.setState({ threads: [doneThread], projects: [project] });
    });
    renderCard({ isCrowned: false });

    await waitFor(() => expect(screen.getByText("Completed · no changes")).toBeInTheDocument());
  });

  it("exposes the full branch without mouse hover", () => {
    const longBranch = "experiment/extremely-long-candidate-branch-name-2026";
    const longBranchCandidate: ExperimentCandidate = {
      ...candidate,
      worktreeBranch: longBranch,
    };
    renderCard({ candidate: longBranchCandidate, isCrowned: false });

    const branch = screen.getByTitle(longBranch);
    expect(branch.textContent).not.toBe(longBranch);
    // The shortened branch sits inside a keyboard-focusable tooltip trigger,
    // so the full value is reachable without a mouse hover.
    const trigger = branch.closest('[data-slot="tooltip-trigger"]');
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveAttribute("role", "button");
  });
});
