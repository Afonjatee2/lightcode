import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { buildFileEditorContext, resolveWorktreeBranch } from "@/renderer/utils/gitHelpers";

export function openSettings(): void {
  usePanelStore.getState().openSettings();
}

export function openProjectSettings(projectId: string): void {
  usePanelStore.getState().openProjectSettings(projectId);
}

export function closeAllPanels(): void {
  usePanelStore.getState().closeAllPanels();
  useDevTerminalStore.getState().closePanel();
}

export function openFilesPanel(projectId: string, worktreePath?: string): void {
  const project = useAppStore.getState().projects.find((item) => item.id === projectId);
  if (!project) return;

  const context = buildFileEditorContext(
    project,
    worktreePath,
    worktreePath ? resolveWorktreeBranch(projectId, worktreePath) : undefined,
  );

  const fileEditor = useFileEditorStore.getState();
  const currentRoot = fileEditor.rootContext;
  const hasDirtyBuffers = Object.values(fileEditor.buffers).some(
    (buffer) => buffer.status === "ready" && buffer.isDirty,
  );
  const isSameContext =
    currentRoot?.projectId === context.projectId &&
    currentRoot?.worktreePath === context.worktreePath;

  if (!isSameContext && hasDirtyBuffers && !window.confirm("Discard unsaved editor changes?")) {
    return;
  }

  if (!isSameContext) {
    fileEditor.setRootContext(context);
  }

  const panelStore = usePanelStore.getState();
  const filesPanelContext = panelStore.filesPanelContext;
  const rightPanelTab = panelStore.rightPanelTab;

  if (
    isSameContext &&
    filesPanelContext?.projectId === context.projectId &&
    filesPanelContext?.worktreePath === context.worktreePath &&
    rightPanelTab === "files"
  ) {
    closeAllPanels();
    return;
  }

  panelStore.setFilesPanelContext(context);
  panelStore.setRightPanelTab("files");
}

export function openGitReview(projectId: string, worktreePath?: string): void {
  const mode = useSharedSettings.getState().gitReviewMode;
  const panelStore = usePanelStore.getState();
  const gitReviewContext = panelStore.gitReviewContext;
  const gitPanelOpen = !!gitReviewContext && panelStore.gitReviewAsPanel;
  const rightPanelTab = panelStore.rightPanelTab;

  if (mode === "panel") {
    const isSameContext =
      gitPanelOpen &&
      gitReviewContext?.projectId === projectId &&
      gitReviewContext?.worktreePath === worktreePath;

    if (isSameContext && rightPanelTab === "git") {
      closeAllPanels();
      return;
    }
    panelStore.setGitReviewContext({ projectId, ...(worktreePath ? { worktreePath } : {}) });
    panelStore.setGitReviewAsPanel(true);
    panelStore.setRightPanelTab("git");
  } else {
    panelStore.setGitReviewContext({ projectId, ...(worktreePath ? { worktreePath } : {}) });
    panelStore.setGitReviewAsPanel(false);
    panelStore.setGitOverlayOpen(true);
  }
}

export function openGitOverlay(): void {
  usePanelStore.getState().setGitOverlayOpen(true);
}

export function closeGitPanel(): void {
  usePanelStore.getState().setGitReviewContext(null);
}

export function openExternalUrl(url: string): void {
  void readBridge()
    .openExternal(url)
    .catch(() => undefined);
}
