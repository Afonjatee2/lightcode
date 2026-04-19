import type { Thread } from "@/shared/contracts";

export interface WorktreeThreadGroup {
  kind: "worktree";
  threads: Thread[];
  worktreePath: string;
  worktreeBranch: string;
}

export interface DefaultThreadGroup {
  kind: "default";
  groupId: string;
  groupName: string;
  threads: Thread[];
}

export type ThreadGroup = WorktreeThreadGroup | DefaultThreadGroup;

export type ThreadListEntry =
  | { kind: "thread"; thread: Thread }
  | { kind: "worktree-group"; group: WorktreeThreadGroup }
  | { kind: "thread-group"; group: DefaultThreadGroup };

/**
 * Groups project threads into an ordered list of entries.
 *
 * Pass 1 — Worktree grouping: multi-thread worktree groups appear at the
 * position of their first thread. Solo worktree threads remain as regular
 * thread entries.
 *
 * Pass 2 — groupId grouping: remaining ungrouped threads that share a
 * `groupId` (from "Continue in Other Provider") are collected into default
 * thread groups. Groups of 1 dissolve into standalone entries.
 */
export function groupThreads(threads: Thread[]): ThreadListEntry[] {
  // ── Pass 1: Worktree grouping ─────────────────────────────
  const worktreeMap = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (thread.worktreePath) {
      const arr = worktreeMap.get(thread.worktreePath);
      if (arr) arr.push(thread);
      else worktreeMap.set(thread.worktreePath, [thread]);
    }
  }

  const multiWorktreeGroups = new Map<string, WorktreeThreadGroup>();
  for (const [path, wtThreads] of worktreeMap) {
    if (wtThreads.length >= 2) {
      multiWorktreeGroups.set(path, {
        kind: "worktree",
        worktreePath: path,
        worktreeBranch: wtThreads[0]!.worktreeBranch ?? path,
        threads: wtThreads,
      });
    }
  }

  // Track which threads are consumed by worktree groups
  const worktreeGroupedIds = new Set<string>();
  for (const group of multiWorktreeGroups.values()) {
    for (const t of group.threads) worktreeGroupedIds.add(t.id);
  }

  // ── Pass 2: groupId grouping ──────────────────────────────
  const groupIdMap = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (thread.groupId && !worktreeGroupedIds.has(thread.id)) {
      const arr = groupIdMap.get(thread.groupId);
      if (arr) arr.push(thread);
      else groupIdMap.set(thread.groupId, [thread]);
    }
  }

  const multiGroupIdGroups = new Map<string, DefaultThreadGroup>();
  for (const [gid, gidThreads] of groupIdMap) {
    if (gidThreads.length >= 2) {
      multiGroupIdGroups.set(gid, {
        kind: "default",
        groupId: gid,
        groupName: gidThreads[0]!.groupName ?? gidThreads[0]!.title,
        threads: gidThreads,
      });
    }
  }

  const groupIdGroupedIds = new Set<string>();
  for (const group of multiGroupIdGroups.values()) {
    for (const t of group.threads) groupIdGroupedIds.add(t.id);
  }

  // ── Build entries in original array order ──────────────────
  const emittedWorktreeGroups = new Set<string>();
  const emittedGroupIdGroups = new Set<string>();
  const entries: ThreadListEntry[] = [];

  for (const thread of threads) {
    // Worktree group
    if (thread.worktreePath && multiWorktreeGroups.has(thread.worktreePath)) {
      if (!emittedWorktreeGroups.has(thread.worktreePath)) {
        emittedWorktreeGroups.add(thread.worktreePath);
        entries.push({
          kind: "worktree-group",
          group: multiWorktreeGroups.get(thread.worktreePath)!,
        });
      }
      continue;
    }

    // groupId group
    if (thread.groupId && multiGroupIdGroups.has(thread.groupId)) {
      if (!emittedGroupIdGroups.has(thread.groupId)) {
        emittedGroupIdGroups.add(thread.groupId);
        entries.push({
          kind: "thread-group",
          group: multiGroupIdGroups.get(thread.groupId)!,
        });
      }
      continue;
    }

    // Standalone thread
    entries.push({ kind: "thread", thread });
  }

  return entries;
}
