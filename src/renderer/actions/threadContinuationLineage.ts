import type { OrchestratorChildSeed, Thread } from "@/shared/contracts";

export interface ContinuationThreadMetadata {
  groupId?: string;
  groupName?: string;
  parentThreadId?: string;
}

export interface ContinuationLineage {
  threadMetadata: ContinuationThreadMetadata;
  sourceGroupPatch?: { groupId: string; groupName: string };
}

/**
 * Preserve Swarm ownership when a worker is moved or forked to another
 * provider. Regular standalone handoffs keep their existing grouping rules.
 */
export function resolveContinuationLineage(
  sourceThread: Thread,
  closeOriginal: boolean,
  threads: readonly Thread[],
): ContinuationLineage {
  if (sourceThread.parentThreadId) {
    const parent = threads.find((thread) => thread.id === sourceThread.parentThreadId);
    const groupId = sourceThread.groupId ?? parent?.groupId ?? sourceThread.parentThreadId;
    const groupName =
      sourceThread.groupName ?? parent?.groupName ?? parent?.title ?? sourceThread.title;
    return {
      threadMetadata: {
        parentThreadId: sourceThread.parentThreadId,
        groupId,
        groupName,
      },
      ...(!sourceThread.groupId ? { sourceGroupPatch: { groupId, groupName } } : {}),
    };
  }

  if (closeOriginal) return { threadMetadata: {} };

  const groupId = sourceThread.groupId ?? crypto.randomUUID();
  const groupName = sourceThread.groupName ?? sourceThread.title;
  return {
    threadMetadata: { groupId, groupName },
    ...(!sourceThread.groupId ? { sourceGroupPatch: { groupId, groupName } } : {}),
  };
}

export function buildOrchestratorChildSeed(thread: Thread): OrchestratorChildSeed | undefined {
  if (!thread.parentThreadId) return undefined;
  return {
    threadId: thread.id,
    parentThreadId: thread.parentThreadId,
    agentKind: thread.agentKind,
    title: thread.title,
    ...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {}),
    ...(thread.worktreeBranch ? { worktreeBranch: thread.worktreeBranch } : {}),
    createdAt: thread.createdAt,
  };
}
