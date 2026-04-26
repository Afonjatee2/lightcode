import { ProjectSidebarPanel } from "@/renderer/components/layout/ProjectSidebarPanel";
import { ProjectFilesPanel } from "@/renderer/views/FileEditorOverlay/parts/ProjectFilesPanel";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";
import { closeAllPanels, openFilesPanel } from "@/renderer/actions/panelActions";
import { GitReviewPanelContent } from "./RightPanel/parts/GitReviewPanelContent";

export function GitFilesSidePanel(props: {
  gitPanelContext: { projectId: string; worktreePath?: string | undefined } | null;
  resolvedFilesPanelContext: FileEditorRootContext | null;
  gitPanelOpen: boolean;
  filesPanelOpen: boolean;
}) {
  const { gitPanelContext, resolvedFilesPanelContext, gitPanelOpen, filesPanelOpen } = props;
  const projects = useAppStore((s) => s.projects);

  const rightPanelTab = usePanelStore((s) => s.rightPanelTab);
  const setRightPanelTab = usePanelStore((s) => s.setRightPanelTab);
  const setGitReviewContext = usePanelStore((s) => s.setGitReviewContext);
  const setGitReviewAsPanel = usePanelStore((s) => s.setGitReviewAsPanel);
  const setGitOverlayOpen = usePanelStore((s) => s.setGitOverlayOpen);
  const setFilesPanelContext = usePanelStore((s) => s.setFilesPanelContext);
  const setFileEditorOverlayMode = useFileEditorStore((s) => s.setOverlayMode);

  return (
    <ProjectSidebarPanel
      activeTab={rightPanelTab === "files" ? "files" : "git"}
      onTabChange={(tab) => setRightPanelTab(tab)}
      gitContent={
        <GitReviewPanelContent
          gitPanelContext={gitPanelContext}
          onClose={() => setGitReviewContext(null)}
          onExpandToOverlay={() => setGitOverlayOpen(true)}
        />
      }
      filesContent={
        resolvedFilesPanelContext ? (
          <ProjectFilesPanel rootContext={resolvedFilesPanelContext} />
        ) : undefined
      }
      showGit={gitPanelOpen}
      showFiles={filesPanelOpen}
      projectName={
        rightPanelTab === "files"
          ? resolvedFilesPanelContext?.rootLabel
          : projects.find((p) => p.id === gitPanelContext?.projectId)?.name
      }
      onExpandGitToOverlay={() => setGitOverlayOpen(true)}
      onExpandFilesToOverlay={() => setFileEditorOverlayMode("fullscreen")}
      onOpenGit={() => {
        if (gitPanelContext) {
          setGitReviewContext({
            projectId: gitPanelContext.projectId,
            ...(gitPanelContext.worktreePath ? { worktreePath: gitPanelContext.worktreePath } : {}),
          });
          setGitReviewAsPanel(true);
          setRightPanelTab("git");
          return;
        }
        if (resolvedFilesPanelContext) {
          setGitReviewContext({
            projectId: resolvedFilesPanelContext.projectId,
            ...(resolvedFilesPanelContext.worktreePath
              ? { worktreePath: resolvedFilesPanelContext.worktreePath }
              : {}),
          });
          setGitReviewAsPanel(true);
          setRightPanelTab("git");
          return;
        }
        const firstProject = projects[0];
        if (firstProject) {
          setGitReviewContext({ projectId: firstProject.id });
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
        if (gitPanelContext) {
          openFilesPanel(gitPanelContext.projectId, gitPanelContext.worktreePath);
          return;
        }
        const firstProject = projects[0];
        if (firstProject) {
          openFilesPanel(firstProject.id);
        }
      }}
      onClose={closeAllPanels}
    />
  );
}
