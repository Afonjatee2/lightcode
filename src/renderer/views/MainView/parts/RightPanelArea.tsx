import type { Project } from "@/shared/contracts";
import { DevTerminalPanel } from "@/renderer/views/MainView/parts/RightPanel/parts/DevTerminalPanel/DevTerminalPanel";
import { UnifiedRightPanel } from "@/renderer/components/layout/UnifiedRightPanel";
import { ProjectFilesPanel } from "@/renderer/views/FileEditorOverlay/parts/ProjectFilesPanel";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { GitReviewPanelContent } from "./RightPanel/parts/GitReviewPanelContent";

export function RightPanelArea(props: {
  projects: Project[];
  gitPanelContext: { projectId: string; worktreePath?: string | undefined } | null;
  resolvedFilesPanelContext: FileEditorRootContext | null;
  gitPanelOpen: boolean;
  filesPanelOpen: boolean;
  closeAllPanels: () => void;
  openFilesPanel: (projectId: string, worktreePath?: string) => void;
}) {
  const {
    projects,
    gitPanelContext,
    resolvedFilesPanelContext,
    gitPanelOpen,
    filesPanelOpen,
    closeAllPanels,
    openFilesPanel,
  } = props;

  const devTerminalOpen = useDevTerminalStore((s) => s.isOpen);
  const rightPanelTab = usePanelStore((s) => s.rightPanelTab);
  const setRightPanelTab = usePanelStore((s) => s.setRightPanelTab);
  const setGitReviewContext = usePanelStore((s) => s.setGitReviewContext);
  const setGitReviewAsPanel = usePanelStore((s) => s.setGitReviewAsPanel);
  const setGitOverlayOpen = usePanelStore((s) => s.setGitOverlayOpen);
  const setFilesPanelContext = usePanelStore((s) => s.setFilesPanelContext);
  const setFileEditorOverlayMode = useFileEditorStore((s) => s.setOverlayMode);

  return (
    <UnifiedRightPanel
      activeTab={rightPanelTab}
      onTabChange={setRightPanelTab}
      terminalContent={<DevTerminalPanel hideHeader />}
      gitContent={
        <GitReviewPanelContent
          gitPanelContext={gitPanelContext}
          onClose={() => setGitReviewContext(null)}
          onExpandToOverlay={() => setGitOverlayOpen(true)}
        />
      }
      filesContent={
        filesPanelOpen && resolvedFilesPanelContext ? (
          <ProjectFilesPanel rootContext={resolvedFilesPanelContext} />
        ) : undefined
      }
      showTerminal={devTerminalOpen}
      showGit={gitPanelOpen}
      showFiles={filesPanelOpen}
      projectName={
        (rightPanelTab === "git"
          ? projects.find((p) => p.id === gitPanelContext?.projectId)?.name
          : rightPanelTab === "files"
            ? resolvedFilesPanelContext?.rootLabel
            : projects.find((p) => p.id === useDevTerminalStore.getState().activeProjectId)
                ?.name) ?? undefined
      }
      onExpandGitToOverlay={() => setGitOverlayOpen(true)}
      onExpandFilesToOverlay={() => setFileEditorOverlayMode("fullscreen")}
      onOpenGit={() => {
        const termProjectId = useDevTerminalStore.getState().activeProjectId;
        if (termProjectId) {
          setGitReviewContext({ projectId: termProjectId });
          setGitReviewAsPanel(true);
          setRightPanelTab("git");
        }
      }}
      onOpenFiles={() => {
        if (resolvedFilesPanelContext) {
          setFilesPanelContext(resolvedFilesPanelContext);
          setRightPanelTab("files");
          return;
        }
        const terminalStore = useDevTerminalStore.getState();
        if (terminalStore.activeProjectId) {
          openFilesPanel(
            terminalStore.activeProjectId,
            terminalStore.activeWorktreePath ?? undefined,
          );
          return;
        }
        if (gitPanelContext) {
          openFilesPanel(gitPanelContext.projectId, gitPanelContext.worktreePath);
          return;
        }
        const firstProject = projects[0];
        if (firstProject) {
          openFilesPanel(firstProject.id);
        }
      }}
      onOpenTerminal={() => {
        const store = useDevTerminalStore.getState();
        if (store.activeProjectId) {
          store.openPanel(store.activeProjectId);
        } else {
          const firstProject = projects[0];
          if (firstProject) {
            store.openPanel(firstProject.id);
            const existing = store.tabs.find(
              (t) => t.projectId === firstProject.id && !t.worktreePath,
            );
            if (!existing) {
              const tab = store.addTab(firstProject.id, firstProject.name);
              store.setActiveTab(tab.id);
            }
          }
        }
      }}
      onClose={closeAllPanels}
    />
  );
}
