import { buildWorktreeLocation } from "@/shared/worktree";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { writeScriptToShell } from "@/renderer/utils/shellUtils";
import { closeAllPanels } from "./panelActions";

export function openTerminal(projectId: string): void {
  const project = useAppStore.getState().projects.find((p) => p.id === projectId);
  if (!project) return;

  const store = useDevTerminalStore.getState();
  const isBottom = useSharedSettings.getState().terminalPosition === "bottom";
  const rightPanelTab = usePanelStore.getState().rightPanelTab;
  const isSameTerminal =
    store.isOpen && store.activeProjectId === projectId && !store.activeWorktreePath;

  if (isSameTerminal && (isBottom || rightPanelTab === "terminal")) {
    if (isBottom) {
      store.closePanel();
    } else {
      closeAllPanels();
      store.closePanel();
    }
    return;
  }
  if (!isSameTerminal) store.openPanel(projectId);
  if (!isBottom) usePanelStore.getState().setRightPanelTab("terminal");

  const existingTab = store.tabs.find((t) => t.projectId === projectId && !t.worktreePath);
  if (existingTab) {
    store.setActiveTab(existingTab.id);
    return;
  }

  const tab = store.addTab(projectId, project.name);
  store.setActiveTab(tab.id);
}

export function openWorktreeTerminal(projectId: string, worktreePath: string): void {
  const project = useAppStore.getState().projects.find((p) => p.id === projectId);
  if (!project) return;

  const store = useDevTerminalStore.getState();
  const isBottom = useSharedSettings.getState().terminalPosition === "bottom";
  const rightPanelTab = usePanelStore.getState().rightPanelTab;
  const isSameWorktree =
    store.isOpen &&
    store.activeProjectId === projectId &&
    store.activeWorktreePath === worktreePath;

  if (isSameWorktree && (isBottom || rightPanelTab === "terminal")) {
    if (isBottom) {
      store.closePanel();
    } else {
      closeAllPanels();
      store.closePanel();
    }
    return;
  }
  if (!isSameWorktree) store.openWorktreePanel(projectId, worktreePath);
  if (!isBottom) usePanelStore.getState().setRightPanelTab("terminal");

  const existingTab = store.tabs.find(
    (t) => t.projectId === projectId && t.worktreePath === worktreePath,
  );
  if (existingTab) {
    store.setActiveTab(existingTab.id);
    return;
  }

  const branchName = worktreePath.split(/[/\\]/).pop() ?? project.name;
  const tab = store.addTab(projectId, branchName, worktreePath);
  store.setActiveTab(tab.id);
}

export function runProjectAction(projectId: string, actionId: string, worktreePath?: string): void {
  const project = useAppStore.getState().projects.find((p) => p.id === projectId);
  if (!project) return;
  const action = project.scripts?.actions?.find((a) => a.id === actionId);
  if (!action) return;

  const location = worktreePath
    ? buildWorktreeLocation(project.location, worktreePath)
    : project.location;

  const store = useDevTerminalStore.getState();
  const tabLabel = action.name;
  const tab = store.addTab(projectId, tabLabel, worktreePath);

  if (useSharedSettings.getState().autoShowTerminalPanel) {
    if (worktreePath) {
      store.openWorktreePanel(projectId, worktreePath);
    } else {
      store.openPanel(projectId);
    }
  }
  store.setActiveTab(tab.id);

  void readBridge().startShell({
    shellId: tab.id,
    projectLocation: location,
    ...(worktreePath ? { worktreePath } : {}),
  });
  writeScriptToShell(tab.id, action.command);
}
