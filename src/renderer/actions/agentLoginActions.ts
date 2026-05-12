import { toast } from "@heroui/react";
import type { Project } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { writeScriptToShell } from "@/renderer/utils/shellUtils";

function resolveLoginProject(): Project | undefined {
  const app = useAppStore.getState();
  const view = app.view;
  const terminalProjectId = useDevTerminalStore.getState().activeProjectId;
  if (terminalProjectId) {
    const project = app.projects.find((candidate) => candidate.id === terminalProjectId);
    if (project) return project;
  }

  if (view.kind === "draft") {
    const project = app.projects.find((candidate) => candidate.id === view.projectId);
    if (project) return project;
  }

  if (view.kind === "thread") {
    const focusedThreadId =
      app.focusedPaneId && view.panes.includes(app.focusedPaneId)
        ? app.focusedPaneId
        : view.panes[0];
    const thread = app.threads.find((candidate) => candidate.id === focusedThreadId);
    const project = thread
      ? app.projects.find((candidate) => candidate.id === thread.projectId)
      : undefined;
    if (project) return project;
  }

  return app.projects[0];
}

export function runAgentTerminalCommand(input: {
  label: string;
  command: string | ((project: Project) => string);
  project?: Project;
  tabPurpose?: string;
  toastPurpose?: string;
}): void {
  const project = input.project ?? resolveLoginProject();
  if (!project) {
    toast.warning("Add a project before opening an agent terminal.");
    return;
  }

  const terminal = useDevTerminalStore.getState();
  const purpose = input.tabPurpose ?? "login";
  const tab = terminal.addTab(project.id, `${input.label} ${purpose}`);
  terminal.openPanel(project.id);
  terminal.setActiveTab(tab.id);
  if (useSharedSettings.getState().terminalPosition !== "bottom") {
    usePanelStore.getState().setRightPanelTab("terminal");
  }

  void readBridge().startShell({
    shellId: tab.id,
    projectLocation: project.location,
  });
  const command = typeof input.command === "function" ? input.command(project) : input.command;
  writeScriptToShell(tab.id, command);
  toast.success(`Opened ${input.label} ${input.toastPurpose ?? purpose} in terminal.`);
}

export function runAgentLoginCommand(input: {
  label: string;
  command: string;
  project?: Project;
}): void {
  runAgentTerminalCommand({
    label: input.label,
    command: input.command,
    ...(input.project ? { project: input.project } : {}),
    tabPurpose: "login",
    toastPurpose: "login",
  });
}
