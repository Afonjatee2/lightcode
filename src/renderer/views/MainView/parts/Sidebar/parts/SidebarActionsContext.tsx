import { createContext, useContext } from "react";

export interface SidebarActions {
  onOpenNewThread: (projectId?: string) => void;
  onOpenNewThreadSideBySide: (projectId: string) => void;
  onOpenSettings: () => void;
  onOpenFiles: (projectId: string, worktreePath?: string) => void;
  onOpenGitReview: (projectId: string, worktreePath?: string) => void;
  onGitSync: (projectId: string, worktreePath?: string) => void;
  onGitPush: (projectId: string, worktreePath: string) => void;
  onGitPull: (projectId: string, worktreePath: string) => void;
  onGitMergeToSource: (projectId: string, worktreePath: string) => void;
  onGitMergeAndRemove: (projectId: string, worktreePath: string) => void;
  onGitPullFromSource: (projectId: string, worktreePath: string) => void;
  onOpenThread: (threadId: string) => void;
  onUnloadThread: (threadId: string) => void;
  onMarkThreadDone: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onDeleteThread: (threadId: string, worktreePath?: string, projectId?: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteWorktreeGroup: (projectId: string, worktreePath: string) => void;
  onOpenProjectSettings: (projectId: string) => void;
  onRunProjectAction: (projectId: string, actionId: string, worktreePath?: string) => void;
  onOpenTerminal: (projectId: string) => void;
  onOpenWorktreeTerminal: (projectId: string, worktreePath: string) => void;
  onContinueInProvider: (threadId: string) => void;
}

const SidebarActionsContext = createContext<SidebarActions | null>(null);

export const SidebarActionsProvider = SidebarActionsContext.Provider;

export function useSidebarActions(): SidebarActions {
  const ctx = useContext(SidebarActionsContext);
  if (!ctx) throw new Error("useSidebarActions must be used inside SidebarActionsProvider");
  return ctx;
}
