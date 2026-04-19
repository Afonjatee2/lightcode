import type { Project } from "@/shared/contracts";
import { buildWorktreeLocation } from "@/shared/worktree";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import type { FileEditorRootContext } from "@/renderer/state/fileEditorStore";

export const GIT_FETCH_PRIORITY_INTERVAL_MS = 180_000;
export const GIT_FETCH_BACKGROUND_INTERVAL_MS = 720_000;
export const STALE_THREAD_SWEEP_INTERVAL_MS = 5 * 60_000;

export function resolveWorktreeBranch(
  projectId: string,
  worktreePath: string,
  fallbackBranch?: string,
): string | undefined {
  const storeBranch = useAppStore
    .getState()
    .threads.find(
      (thread) =>
        thread.projectId === projectId &&
        thread.worktreePath === worktreePath &&
        thread.worktreeBranch,
    )?.worktreeBranch;
  if (storeBranch) return storeBranch;

  const gitBranch = useGitStore
    .getState()
    .worktrees[projectId]?.find((worktree) => worktree.path === worktreePath)?.branch;
  if (gitBranch) return gitBranch;

  return fallbackBranch;
}

export function buildFileEditorContext(
  project: Project,
  worktreePath?: string,
  worktreeBranch?: string,
): FileEditorRootContext {
  if (!worktreePath) {
    return {
      projectId: project.id,
      projectName: project.name,
      projectLocation: project.location,
      rootLabel: project.name,
    };
  }

  return {
    projectId: project.id,
    projectName: project.name,
    projectLocation: buildWorktreeLocation(project.location, worktreePath),
    rootLabel: worktreeBranch ?? worktreePath.split(/[/\\]/).pop() ?? project.name,
    worktreePath,
  };
}

export function autoDetectSetupScript(project: Project) {
  void readBridge()
    .detectSetupScript({ projectLocation: project.location })
    .then((result) => {
      if (result.setupScript) {
        useAppStore.getState().updateProjectScripts(project.id, {
          setupScript: result.setupScript,
          actions: [],
        });
      }
    })
    .catch(() => undefined);
}
