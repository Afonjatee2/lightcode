import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Project, Thread, ThreadStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useThreadLiveWorkflowStore } from "@/renderer/state/threadLiveWorkflowStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { SwarmActivityPanel } from "./SwarmActivityPanel";

const project: Project = {
  id: "project-1",
  name: "Lightcode",
  location: { kind: "posix", path: "/repo" },
  createdAt: "2026-07-21T20:00:00.000Z",
};

function makeThread(input: {
  id: string;
  title: string;
  status?: ThreadStatus;
  parentThreadId?: string;
  branch?: string;
}): Thread {
  return {
    id: input.id,
    projectId: project.id,
    title: input.title,
    agentKind: input.id.includes("qwen") ? "qwen" : "codex",
    config: { model: input.id.includes("qwen") ? "qwen3.8-max-preview" : "gpt-5.6-sol" },
    status: input.status ?? "idle",
    attention: "none",
    canResumeWithConfig: true,
    archived: false,
    done: false,
    starred: false,
    groupId: "root",
    groupName: "Swarm · Build feature",
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    ...(input.branch ? { worktreeBranch: input.branch } : {}),
    createdAt: "2026-07-21T20:00:00.000Z",
    updatedAt: "2026-07-21T20:05:00.000Z",
  };
}

describe("SwarmActivityPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ projects: [project], threads: [], view: { kind: "home" } });
    useAgentStatusesStore.setState({ agentStatuses: [], wslAgentStatuses: [] });
    useThreadLiveWorkflowStore.setState({ liveThreadIds: new Set<string>() });
  });

  it("shows the orchestration stage before the first worker is created", () => {
    const parent = makeThread({ id: "root", title: "Swarm · Build feature", status: "working" });
    useAppStore.setState({ threads: [parent] });

    render(<SwarmActivityPanel parentThread={parent} />);

    expect(screen.getByText("Preparing worker assignments…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open All" })).not.toBeInTheDocument();
  });

  it("tracks every child and opens the team grid", () => {
    const parent = makeThread({ id: "root", title: "Swarm · Build feature", status: "working" });
    const working = makeThread({
      id: "qwen-worker",
      title: "Replace Share of Voice chart",
      status: "working",
      parentThreadId: parent.id,
      branch: "swarm/chart",
    });
    const finished = makeThread({
      id: "codex-worker",
      title: "Audit vendor-neutral copy",
      status: "finished",
      parentThreadId: parent.id,
      branch: "swarm/copy",
    });
    const failed = makeThread({
      id: "codex-failed",
      title: "Run regression tests",
      status: "error",
      parentThreadId: parent.id,
      branch: "swarm/tests",
    });
    const replacedSource = {
      ...makeThread({
        id: "codex-replaced",
        title: "Previous stalled worker",
        parentThreadId: parent.id,
      }),
      done: true,
    };
    const groupedNonWorker = makeThread({
      id: "codex-grouped",
      title: "Unrelated grouped thread",
    });
    useAppStore.setState({
      threads: [parent, working, finished, failed, replacedSource, groupedNonWorker],
    });

    render(<SwarmActivityPanel parentThread={parent} />);

    expect(screen.getByText("Replace Share of Voice chart")).toBeInTheDocument();
    expect(screen.getByText("Audit vendor-neutral copy")).toBeInTheDocument();
    expect(screen.getByText("Run regression tests")).toBeInTheDocument();
    expect(screen.queryByText("Previous stalled worker")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated grouped thread")).not.toBeInTheDocument();
    expect(screen.getAllByText("Working").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finished").length).toBeGreaterThan(0);
    expect(screen.getByText("Failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Replace Share of Voice chart/ }));
    expect(useAppStore.getState().view).toEqual({ kind: "thread", panes: [working.id] });

    fireEvent.click(screen.getByRole("button", { name: "Open All" }));
    expect(useAppStore.getState().view).toMatchObject({
      kind: "thread",
      activeGroupId: "root",
      panes: expect.arrayContaining([parent.id, working.id, finished.id, failed.id]),
    });

    const threadsBeforeSingleView = useAppStore.getState().threads;
    fireEvent.click(screen.getByRole("button", { name: "Orchestrator only" }));
    expect(useAppStore.getState().view).toEqual({ kind: "thread", panes: [parent.id] });
    expect(useAppStore.getState().threads).toEqual(threadsBeforeSingleView);
  });
});
