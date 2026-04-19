import { lazy, Suspense, useEffect } from "react";
import { getAppName } from "@/shared/appName";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import { Sidebar } from "@/renderer/views/MainView/parts/Sidebar/Sidebar";
import { AppContent } from "@/renderer/views/MainView/parts/AppContent/AppContent";
import { SidebarHeaderControls } from "@/renderer/views/MainView/parts/SidebarHeaderControls";
import { MainRightPanel } from "@/renderer/views/MainView/parts/MainRightPanel";
import { MainGitPanel } from "@/renderer/views/MainView/parts/MainGitPanel";
import { useAppStore } from "@/renderer/state/appStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { closeAllPanels } from "@/renderer/actions/panelActions";

const FileEditorPanel = lazy(() =>
  import("@/renderer/views/FileEditorOverlay/parts/FileEditorPanel").then((m) => ({
    default: m.FileEditorPanel,
  })),
);

export function MainPageLayout(props: { wslAvailable: boolean; onTitleClick: () => void }) {
  const { wslAvailable, onTitleClick } = props;

  return (
    <PageLayout
      title={getAppName(import.meta.env.DEV)}
      onTitleClick={onTitleClick}
      onRequestClosePanels={closeAllPanels}
      sidebarHeaderChildren={<SidebarHeaderControls wslAvailable={wslAvailable} />}
      sidebar={<Sidebar />}
      content={
        <>
          <AppContent />
          <Suspense>
            <FileEditorPanel />
          </Suspense>
        </>
      }
      rightPanel={<MainRightPanel />}
      gitPanel={<MainGitPanel />}
    />
  );
}

export function StalePanelCleanup() {
  const projects = useAppStore((state) => state.projects);
  const fileEditorRootContext = useFileEditorStore((state) => state.rootContext);
  const clearFileEditorSession = useFileEditorStore((state) => state.clearSession);
  const gitReviewContext = usePanelStore((s) => s.gitReviewContext);
  const gitOverlayOpen = usePanelStore((s) => s.gitOverlayOpen);
  const filesPanelContext = usePanelStore((s) => s.filesPanelContext);

  useEffect(() => {
    const projectIds = new Set(projects.map((project) => project.id));
    const panelStore = usePanelStore.getState();

    if (gitReviewContext && !projectIds.has(gitReviewContext.projectId)) {
      panelStore.setGitOverlayOpen(false);
      panelStore.setGitReviewContext(null);
    } else if (!gitReviewContext && gitOverlayOpen) {
      panelStore.setGitOverlayOpen(false);
    }

    if (filesPanelContext && !projectIds.has(filesPanelContext.projectId)) {
      panelStore.setFilesPanelContext(null);
    }

    if (fileEditorRootContext && !projectIds.has(fileEditorRootContext.projectId)) {
      clearFileEditorSession();
    }
  }, [
    clearFileEditorSession,
    fileEditorRootContext,
    filesPanelContext,
    gitOverlayOpen,
    gitReviewContext,
    projects,
  ]);

  return null;
}
