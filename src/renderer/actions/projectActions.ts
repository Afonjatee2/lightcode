import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { usePanelStore } from "@/renderer/state/panelStore";

export function setProjectDisabled(projectId: string, disabled: boolean): void {
  const store = useAppStore.getState();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return;
  if ((project.disabled ?? false) === disabled) return;

  store.setProjectDisabled(projectId, disabled);

  if (disabled) {
    void readBridge()
      .gitUnwatchProject({ projectId })
      .catch(() => undefined);

    useGitStore.getState().clearStatus(projectId);

    const termStore = useDevTerminalStore.getState();
    if (termStore.isOpen && termStore.activeProjectId === projectId) {
      termStore.closePanel();
    }

    const panelStore = usePanelStore.getState();
    if (panelStore.gitReviewContext?.projectId === projectId) {
      panelStore.setGitOverlayOpen(false);
      panelStore.setGitReviewContext(null);
    }
    if (panelStore.filesPanelContext?.projectId === projectId) {
      panelStore.setFilesPanelContext(null);
      useFileEditorStore.getState().clearSession();
    }
  }
}

export function deleteProject(projectId: string): void {
  const store = useAppStore.getState();
  const projectThreadIds = store.threads.filter((t) => t.projectId === projectId).map((t) => t.id);

  store.deleteProject(projectId);

  for (const threadId of projectThreadIds) {
    void readBridge()
      .closeThread({ threadId })
      .catch(() => undefined);
  }

  const termStore = useDevTerminalStore.getState();
  const removedTabIds = termStore.removeTabsForProject(projectId);
  for (const tabId of removedTabIds) {
    void readBridge()
      .closeThread({ threadId: tabId })
      .catch(() => undefined);
  }

  if (termStore.isOpen && termStore.activeProjectId === projectId) {
    termStore.closePanel();
  }

  useGitStore.getState().clearStatus(projectId);

  const panelStore = usePanelStore.getState();
  if (panelStore.gitReviewContext?.projectId === projectId) {
    panelStore.setGitOverlayOpen(false);
    panelStore.setGitReviewContext(null);
  }
  if (panelStore.filesPanelContext?.projectId === projectId) {
    panelStore.setFilesPanelContext(null);
    useFileEditorStore.getState().clearSession();
  }
}
