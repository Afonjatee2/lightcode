import type { SidebarActions } from "@/renderer/views/MainView/parts/Sidebar/parts/SidebarActionsContext";
import { closeAllPanels, openFilesPanel, openGitReview } from "@/renderer/actions/panelActions";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  gitMergeAndRemove,
  gitMergeToSource,
  gitPull,
  gitPullFromSource,
  gitPush,
  gitSync,
} from "@/renderer/actions/gitActions";
import {
  openTerminal,
  openWorktreeTerminal,
  runProjectAction,
} from "@/renderer/actions/terminalActions";
import {
  archiveThread,
  continueInProvider,
  deleteThread,
  openNewThread,
  openNewThreadSideBySide,
  openThread,
  renameThread,
  toggleMarkThreadDone,
  unloadThread,
} from "@/renderer/actions/threadActions";
import { deleteProject } from "@/renderer/actions/projectActions";
import { deleteWorktreeGroup } from "@/renderer/actions/worktreeActions";
import { useAppStore } from "@/renderer/state/appStore";

const sidebarActions: SidebarActions = {
  onOpenNewThread: openNewThread,
  onOpenNewThreadSideBySide: openNewThreadSideBySide,
  onOpenSettings: () => usePanelStore.getState().openSettings(),
  onOpenFiles: openFilesPanel,
  onOpenGitReview: openGitReview,
  onGitSync: gitSync,
  onGitPush: gitPush,
  onGitPull: gitPull,
  onGitMergeToSource: gitMergeToSource,
  onGitMergeAndRemove: gitMergeAndRemove,
  onGitPullFromSource: gitPullFromSource,
  onOpenThread: openThread,
  onUnloadThread: unloadThread,
  onMarkThreadDone: toggleMarkThreadDone,
  onArchiveThread: archiveThread,
  onRenameThread: renameThread,
  onDeleteThread: deleteThread,
  onDeleteProject: deleteProject,
  onDeleteWorktreeGroup: (projectId, worktreePath) => {
    const threadIds = useAppStore
      .getState()
      .threads.filter((t) => t.worktreePath === worktreePath && t.projectId === projectId)
      .map((t) => t.id);
    deleteWorktreeGroup(projectId, worktreePath, threadIds);
  },
  onOpenProjectSettings: (projectId) => usePanelStore.getState().openProjectSettings(projectId),
  onRunProjectAction: runProjectAction,
  onOpenTerminal: openTerminal,
  onOpenWorktreeTerminal: openWorktreeTerminal,
  onContinueInProvider: continueInProvider,
};

export function useMainViewActions() {
  return { sidebarActions, closeAllPanels };
}
