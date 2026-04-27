import { startTransition } from "react";
import { isDraftPaneId } from "@/shared/paneId";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useWorktreeDeleteStore } from "@/renderer/state/worktreeDeleteStore";
import { readWorktreeDeletePref } from "@/renderer/views/MainView/parts/Sidebar/parts/DeleteWorktreeDialog";
import { resolveWorktreeBranch } from "@/renderer/utils/gitHelpers";
import { closeThreads } from "@/renderer/utils/shellUtils";
import { closePanelsForUnloadedThread } from "./panelActions";
import { getCurrentProjectId } from "./currentProject";
import { performWorktreeRemoval } from "./worktreeActions";

export function openNewThread(projectId?: string): void {
  const store = useAppStore.getState();
  const targetProjectId = projectId ?? getCurrentProjectId() ?? store.projects[0]?.id;
  startTransition(() => {
    if (!targetProjectId) {
      useAppStore.getState().openHome();
      return;
    }
    const mode = useSharedSettings.getState().newThreadMode;
    const view = useAppStore.getState().view;
    if (mode === "panel" && view.kind === "thread" && view.panes.length > 0) {
      useAppStore.getState().openDraftSideBySide(targetProjectId);
    } else {
      useAppStore.getState().openDraft(targetProjectId);
    }
  });
}

export function openNewThreadSideBySide(projectId: string): void {
  startTransition(() => {
    useAppStore.getState().openDraftSideBySide(projectId);
  });
}

export function openThread(threadId: string): void {
  const thread = useAppStore.getState().threads.find((item) => item.id === threadId);

  startTransition(() => {
    useAppStore.getState().openThread(threadId);
  });

  if (thread?.status === "inactive") {
    reopenStoredThread(threadId);
  }
}

export function reopenStoredThread(threadId: string): void {
  const store = useAppStore.getState();
  const thread = store.threads.find((item) => item.id === threadId);
  if (!thread) return;
  if (thread.status !== "inactive" || store.pendingThreadLaunches[thread.id] !== undefined) {
    return;
  }

  startTransition(() => {
    store.updateThreadRuntime(thread.id, {
      status: "launching",
      attention: "none",
      ...(thread.sessionRef ? { sessionRef: thread.sessionRef } : {}),
      canResumeWithConfig: thread.canResumeWithConfig || thread.sessionRef !== undefined,
    });
  });
  store.queueThreadLaunch(thread.id, "");
}

export async function unloadStoredThread(
  threadId: string,
  options?: { closeThreadPane?: boolean },
): Promise<void> {
  const thread = useAppStore.getState().threads.find((item) => item.id === threadId);
  if (
    !thread ||
    thread.status === "inactive" ||
    thread.status === "launching" ||
    !thread.sessionRef
  ) {
    return;
  }

  const view = useAppStore.getState().view;
  const inVisiblePane = view.kind === "thread" && view.panes.includes(threadId);

  await readBridge().closeThread({ threadId });
  startTransition(() => {
    useAppStore.getState().markThreadExited(threadId);
    if (inVisiblePane) {
      closePanelsForUnloadedThread(thread);
    }
    if (options?.closeThreadPane && inVisiblePane) {
      useAppStore.getState().closePane(threadId);
    }
  });
}

export function sweepStaleThreads(): void {
  const staleThreadUnloadMinutes = useSharedSettings.getState().staleThreadUnloadMinutes;
  if (staleThreadUnloadMinutes <= 0) return;

  const store = useAppStore.getState();
  const visibleThreadIds = new Set(store.view.kind === "thread" ? store.view.panes : []);
  const staleBefore = Date.now() - staleThreadUnloadMinutes * 60_000;

  for (const thread of store.threads) {
    if (
      visibleThreadIds.has(thread.id) ||
      (thread.status !== "idle" && thread.status !== "finished") ||
      !thread.sessionRef ||
      new Date(thread.updatedAt).getTime() > staleBefore
    ) {
      continue;
    }

    void unloadStoredThread(thread.id).catch(() => undefined);
  }
}

export function archiveThread(threadId: string): void {
  void unloadStoredThread(threadId).catch(() => undefined);
  useAppStore.getState().archiveThread(threadId);
}

export function unloadThread(threadId: string): void {
  void unloadStoredThread(threadId, { closeThreadPane: true }).catch(() => undefined);
}

export function toggleMarkThreadDone(threadId: string): void {
  const store = useAppStore.getState();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) return;
  if (thread.done) {
    store.unmarkThreadDone(threadId);
  } else {
    void unloadStoredThread(threadId).catch(() => undefined);
    store.markThreadDone(threadId);
  }
}

export function toggleStarThread(threadId: string): void {
  const store = useAppStore.getState();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) return;
  if (thread.starred) {
    store.unstarThread(threadId);
  } else {
    store.starThread(threadId);
  }
}

export function renameThread(threadId: string, title: string): void {
  useAppStore.getState().renameThread(threadId, title);
}

export function deleteThread(threadId: string, worktreePath?: string, projectId?: string): void {
  const deleteThreadStoreAction = useAppStore.getState().deleteThread;

  if (!worktreePath) {
    deleteThreadStoreAction(threadId);
    void readBridge()
      .closeThread({ threadId })
      .catch(() => undefined);
    return;
  }

  const pref = readWorktreeDeletePref();
  if (pref === "thread-only") {
    deleteThreadStoreAction(threadId);
    void readBridge()
      .closeThread({ threadId })
      .catch(() => undefined);
    return;
  }

  if (pref === "thread-and-worktree") {
    const allThreads = useAppStore.getState().threads;
    const thread = allThreads.find((t) => t.id === threadId);
    const siblings = allThreads.filter((t) => t.worktreePath === worktreePath && t.id !== threadId);
    deleteThreadStoreAction(threadId);
    for (const t of siblings) {
      deleteThreadStoreAction(t.id);
    }

    const project = useAppStore.getState().projects.find((p) => p.id === projectId);
    if (project) {
      void (async () => {
        await closeThreads([threadId, ...siblings.map((t) => t.id)]);
        await performWorktreeRemoval(project, worktreePath, thread?.worktreeBranch);
      })();
    }
    return;
  }

  const thread = useAppStore.getState().threads.find((t) => t.id === threadId);
  useWorktreeDeleteStore.getState().setDialog({
    kind: "single-thread",
    threadId,
    projectId: projectId!,
    worktreePath,
    worktreeBranch:
      resolveWorktreeBranch(projectId!, worktreePath, thread?.worktreeBranch) ??
      worktreePath.split(/[/\\]/).pop() ??
      worktreePath,
  });
}

export function continueInProvider(threadId: string): void {
  useAppStore.getState().openThread(threadId);
}

export function reopenPaneThreadsIfInactive(): void {
  const store = useAppStore.getState();
  if (store.view.kind !== "thread") return;
  for (const paneId of store.view.panes) {
    if (isDraftPaneId(paneId)) continue;
    const thread = store.threads.find((t) => t.id === paneId);
    if (!thread || thread.status !== "inactive") continue;
    reopenStoredThread(thread.id);
  }
}
