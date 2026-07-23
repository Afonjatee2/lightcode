// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useDesktopPanelStore } from "../desktopPanelStore";
import { useGitSummariesStore } from "../gitSummaries";
import type { RemoteDesktopSession } from "../useRemoteDesktop";
import { DesktopWorkspacePanel } from "./DesktopWorkspacePanel";

const { openFileInEditor, showTerminalPanel } = vi.hoisted(() => ({
  openFileInEditor: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  showTerminalPanel: vi.fn<(projectId: string, worktreePath?: string) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn<(options: unknown) => void>(),
}));

vi.mock("@/renderer/actions/terminalActions", () => ({
  showTerminalPanel,
}));

vi.mock("@/renderer/utils/gitHelpers", async () => {
  const actual = await vi.importActual<typeof import("@/renderer/utils/gitHelpers")>(
    "@/renderer/utils/gitHelpers",
  );
  return {
    ...actual,
    openFileInEditor,
  };
});

vi.mock("../useGitSummaryHydration", () => ({
  useGitSummaryHydration: () => undefined,
}));

vi.mock("@/renderer/views/MainView/parts/RightPanel/parts/NotesPanel/NotesPanel", () => ({
  NotesPanel: () => <div data-testid="notes-panel">Notes content</div>,
}));

vi.mock("@/renderer/views/MainView/parts/RightPanel/parts/UsagePanel/UsagePanel", () => ({
  UsagePanel: () => <div data-testid="usage-panel">Usage content</div>,
}));

vi.mock("./PortsView", () => ({
  PortsView: () => <div data-testid="ports-view">Ports content</div>,
}));

vi.mock(
  "@/renderer/views/MainView/parts/RightPanel/parts/DevTerminalPanel/DevTerminalPanel",
  () => ({
    DevTerminalPanel: (props: { positionOverride?: string }) => (
      <div data-testid="terminal-view" data-position={props.positionOverride}>
        Terminal content
      </div>
    ),
  }),
);

vi.mock("@/renderer/views/MainView/parts/RightPanel/parts/GitReviewPanelContent", () => ({
  GitReviewPanelContent: () => <div data-testid="git-view">Git content</div>,
}));

vi.mock("@/renderer/views/FileEditorOverlay/parts/ProjectFilesPanel", () => ({
  ProjectFilesPanel: (props: { rootContext: { rootLabel: string } }) => (
    <div data-testid="files-view">{props.rootContext.rootLabel}</div>
  ),
}));

const project: Project = {
  id: "project-1",
  name: "Repo",
  location: { kind: "posix", path: "/repo" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const thread = {
  id: "thread-1",
  projectId: project.id,
  title: "Thread",
  agentKind: "claude",
  config: {},
  status: "idle",
  attention: "none",
  canResumeWithConfig: false,
  archived: false,
  done: false,
  starred: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Thread;

const remote = {
  projects: [project],
  threads: [thread],
  activeDesktop: { desktopId: "desktop-1" },
  startThread: vi.fn<(project: Project, input: unknown) => Promise<string | null>>(),
} as unknown as RemoteDesktopSession;

function renderPanel() {
  return render(<DesktopWorkspacePanel remote={remote} currentThreadId={thread.id} />);
}

describe("DesktopWorkspacePanel", () => {
  beforeEach(() => {
    openFileInEditor.mockClear();
    showTerminalPanel.mockClear();
    localStorage.clear();
    useDesktopPanelStore.setState({
      open: false,
      activeTab: "files",
      threadId: thread.id,
      initialFilePath: null,
      initialFolderPath: null,
      initialLineNumber: null,
      openRequestKey: 0,
    });
    const gitSummary = {
      isRepo: true,
      branch: "main",
      totalInsertions: 0,
      totalDeletions: 0,
      ahead: 0,
      behind: 0,
      pr: null,
    };
    useGitSummariesStore.setState({
      byThread: { [thread.id]: gitSummary },
      localByThread: {},
      remoteByThread: { [thread.id]: gitSummary },
    });
  });

  it("keeps the tool rail visible and opens auxiliary tabs in place", () => {
    const { container } = renderPanel();

    expect(screen.queryByTestId("files-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("usage-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notes-panel")).not.toBeInTheDocument();
    expect(container.querySelector(".m-desktop-tool-rail__collapsed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Git" }));
    expect(screen.getByTestId("git-view")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Usage" })[0]!);
    expect(screen.getByTestId("usage-panel").parentElement).toHaveStyle({
      pointerEvents: "auto",
    });
    expect(screen.getByTestId("usage-panel").parentElement).toHaveClass(
      "flex",
      "min-h-0",
      "flex-col",
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Ports" })[0]!);
    expect(screen.getByTestId("ports-view").parentElement).toHaveStyle({
      pointerEvents: "auto",
    });

    expect(screen.queryByRole("button", { name: "Goals" })).not.toBeInTheDocument();
  });

  it("uses the Electron right-terminal layout without changing the saved terminal position", async () => {
    const { rerender } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));

    await waitFor(() => {
      expect(showTerminalPanel).toHaveBeenCalledWith(project.id, undefined);
    });
    expect(screen.getByTestId("terminal-view")).toHaveAttribute("data-position", "right");

    rerender(
      <DesktopWorkspacePanel
        remote={{ ...remote, threads: [{ ...thread, title: "Updated" }] }}
        currentThreadId={thread.id}
      />,
    );
    expect(showTerminalPanel).toHaveBeenCalledTimes(1);
  });

  it("opens file deep links through the shared desktop editor flow", async () => {
    useDesktopPanelStore.getState().showFile(thread.id, "src/app.ts", 42);
    const { rerender } = renderPanel();

    await waitFor(() => {
      expect(openFileInEditor).toHaveBeenCalledWith(
        project,
        undefined,
        undefined,
        "src/app.ts",
        42,
      );
    });
    expect(screen.getByTestId("files-view")).toHaveTextContent("Repo");

    rerender(
      <DesktopWorkspacePanel
        remote={{ ...remote, threads: [{ ...thread, title: "Updated" }] }}
        currentThreadId={thread.id}
      />,
    );
    expect(openFileInEditor).toHaveBeenCalledTimes(1);
  });
});
