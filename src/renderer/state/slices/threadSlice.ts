import {
  type AgentInstanceId,
  type AppView,
  type SessionRef,
  type Thread,
  type ThreadAttention,
  type ThreadConfig,
  type ThreadPresentationMode,
  type ThreadRuntimeSnapshot,
  type ThreadServerRequestId,
  type ThreadStatus,
  type ThreadStatusSource,
  isThreadConfigEqual,
} from "@/shared/contracts";
import {
  reorderThreadBlockInProject,
  reorderThreadsInProject,
  type ReorderPlacement,
} from "../reorder";
import { makeThreadTitle, removePaneFromView, replacePaneInView, stripPlanMode } from "./helpers";
import type { SliceCreator } from "./shared";

export interface ThreadSlice {
  threads: Thread[];
  markThreadsInactiveOnLaunch: () => void;
  createThread: (input: {
    projectId: string;
    agentKind: Thread["agentKind"];
    agentInstanceId?: AgentInstanceId;
    config: ThreadConfig;
    prompt: string;
    worktreePath?: string;
    worktreeBranch?: string;
    groupId?: string;
    groupName?: string;
    replacePaneId?: string;
    presentationMode?: ThreadPresentationMode;
  }) => Thread;
  deleteThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => void;
  updateThreadConfig: (threadId: string, config: ThreadConfig) => void;
  updateThreadRuntime: (
    threadId: string,
    input: {
      status: ThreadStatus;
      attention: ThreadAttention;
      config?: ThreadConfig;
      sessionRef?: SessionRef;
      canResumeWithConfig: boolean;
      threadStatusSource?: ThreadStatusSource;
    },
  ) => void;
  archiveThread: (threadId: string) => void;
  unarchiveThread: (threadId: string) => void;
  markThreadDone: (threadId: string) => void;
  unmarkThreadDone: (threadId: string) => void;
  starThread: (threadId: string) => void;
  unstarThread: (threadId: string) => void;
  purgeStaleArchivedThreads: (maxAgeDays: number) => void;
  archiveOldDoneThreads: (maxAgeDays: number) => void;
  markThreadExited: (threadId: string) => void;
  touchThread: (threadId: string) => void;
  reconcileRuntimeSnapshots: (snapshots: ThreadRuntimeSnapshot[]) => void;
  reorderThreads: (sourceId: string, targetId: string, placement: ReorderPlacement) => void;
  reorderThreadBlock: (blockIds: string[], targetId: string, placement: ReorderPlacement) => void;
}

export const createThreadSlice: SliceCreator<ThreadSlice> = (set) => ({
  threads: [],
  markThreadsInactiveOnLaunch: () =>
    set((state) => {
      let changed = false;

      const threads = state.threads.map((thread) => {
        if (thread.status === "inactive" || thread.status === "error") {
          return thread;
        }

        changed = true;
        return {
          ...thread,
          status: "inactive" as ThreadStatus,
          attention: "none" as ThreadAttention,
        };
      });

      return changed ? { threads } : {};
    }),
  createThread: ({
    projectId,
    agentKind,
    agentInstanceId,
    config,
    prompt,
    worktreePath,
    worktreeBranch,
    groupId,
    groupName,
    replacePaneId: replacePaneIdParam,
    presentationMode,
  }) => {
    const now = new Date().toISOString();
    const thread: Thread = {
      id: crypto.randomUUID(),
      projectId,
      title: makeThreadTitle(prompt),
      agentKind,
      ...(agentInstanceId ? { agentInstanceId } : {}),
      config,
      status: "launching",
      attention: "none",
      canResumeWithConfig: false,
      archived: false,
      done: false,
      starred: false,
      presentationMode: presentationMode ?? "terminal",
      threadStatusSource: (presentationMode ?? "terminal") !== "terminal" ? "server" : undefined,
      ...(worktreePath ? { worktreePath } : {}),
      ...(worktreeBranch ? { worktreeBranch } : {}),
      ...(groupId ? { groupId } : {}),
      ...(groupName ? { groupName } : {}),
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      let nextView: AppView;
      if (replacePaneIdParam && state.view.kind === "thread") {
        const idx = state.view.panes.indexOf(replacePaneIdParam);
        if (idx !== -1) {
          nextView = replacePaneInView(state.view, replacePaneIdParam, thread.id);
        } else {
          nextView = { kind: "thread", panes: [thread.id] };
        }
      } else {
        nextView = { kind: "thread", panes: [thread.id] };
      }
      return { threads: [thread, ...state.threads], view: nextView };
    });

    return thread;
  },
  deleteThread: (threadId) =>
    set((state) => {
      const nextThreads = state.threads.filter((thread) => thread.id !== threadId);

      if (nextThreads.length === state.threads.length) {
        return {};
      }

      let nextView = state.view;
      if (state.view.kind === "thread") {
        nextView = removePaneFromView(state.view, threadId);
      }

      const { [threadId]: _droppedItemIds, ...runtimeItemIdsByThread } =
        state.runtimeItemIdsByThread;
      const { [threadId]: _droppedItems, ...runtimeItemsByIdByThread } =
        state.runtimeItemsByIdByThread;
      const { [threadId]: _droppedReqs, ...runtimeRequestsByThread } =
        state.runtimeRequestsByThread;
      return {
        threads: nextThreads,
        pendingServerRequests: state.pendingServerRequests.filter(
          (request) => request.threadId !== threadId,
        ),
        pendingThreadLaunches: Object.fromEntries(
          Object.entries(state.pendingThreadLaunches).filter(([id]) => id !== threadId),
        ),
        pendingLaunchSegments: Object.fromEntries(
          Object.entries(state.pendingLaunchSegments).filter(([id]) => id !== threadId),
        ),
        runtimeItemIdsByThread,
        runtimeItemsByIdByThread,
        runtimeRequestsByThread,
        view: nextView,
      };
    }),
  renameThread: (threadId, title) =>
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, title, updatedAt: new Date().toISOString() } : thread,
      ),
    })),
  updateThreadConfig: (threadId, config) =>
    set((state) => {
      let changed = false;
      const threads = state.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        const nextConfig = thread.presentationMode === "gui" ? config : stripPlanMode(config);
        if (isThreadConfigEqual(thread.config, nextConfig)) return thread;
        changed = true;
        return {
          ...thread,
          config: nextConfig,
          updatedAt: new Date().toISOString(),
        };
      });
      return changed ? { threads } : {};
    }),
  updateThreadRuntime: (threadId, input) =>
    set((state) => {
      let changed = false;
      const isVisible = state.view.kind === "thread" && state.view.panes.includes(threadId);

      const threads: Thread[] = state.threads.map((thread): Thread => {
        if (thread.id !== threadId) {
          return thread;
        }

        let effectiveStatus = input.status;
        if (
          input.status === "idle" &&
          (thread.status === "working" || thread.status === "finished") &&
          !isVisible
        ) {
          effectiveStatus = "finished";
        }

        const sessionRefChanged =
          input.sessionRef !== undefined &&
          (thread.sessionRef?.providerSessionId !== input.sessionRef.providerSessionId ||
            thread.sessionRef?.discoveredAt !== input.sessionRef.discoveredAt);

        const statusSourceMatch =
          input.threadStatusSource === undefined ||
          thread.threadStatusSource === input.threadStatusSource;

        const nextConfig =
          thread.presentationMode === "gui"
            ? (input.config ?? thread.config)
            : stripPlanMode(input.config ?? thread.config);

        if (
          thread.status === effectiveStatus &&
          thread.attention === input.attention &&
          isThreadConfigEqual(thread.config, nextConfig) &&
          thread.canResumeWithConfig === input.canResumeWithConfig &&
          statusSourceMatch &&
          !sessionRefChanged
        ) {
          return thread;
        }

        changed = true;
        return {
          ...thread,
          status: effectiveStatus,
          attention: input.attention,
          config: nextConfig,
          canResumeWithConfig: input.canResumeWithConfig,
          ...(input.threadStatusSource !== undefined
            ? { threadStatusSource: input.threadStatusSource }
            : {}),
          ...(input.sessionRef ? { sessionRef: input.sessionRef } : {}),
          ...(input.status === "working" && thread.status !== "working"
            ? { updatedAt: new Date().toISOString() }
            : {}),
        };
      });

      return changed ? { threads } : {};
    }),
  archiveThread: (threadId) =>
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread || thread.archived) return {};

      const threads = state.threads.map((t) =>
        t.id === threadId ? { ...t, archived: true, updatedAt: new Date().toISOString() } : t,
      );

      let nextView = state.view;
      if (state.view.kind === "thread") {
        nextView = removePaneFromView(state.view, threadId);
      }

      return { threads, view: nextView };
    }),
  unarchiveThread: (threadId) =>
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread || !thread.archived) return {};

      return {
        threads: state.threads.map((t) =>
          t.id === threadId ? { ...t, archived: false, updatedAt: new Date().toISOString() } : t,
        ),
      };
    }),
  markThreadDone: (threadId) =>
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread || thread.done) return {};

      const now = new Date().toISOString();
      const threads = state.threads.map((t) =>
        t.id === threadId ? { ...t, done: true, starred: false, updatedAt: now } : t,
      );

      let nextView = state.view;
      if (state.view.kind === "thread") {
        nextView = removePaneFromView(state.view, threadId);
      }

      return { threads, view: nextView };
    }),
  unmarkThreadDone: (threadId) =>
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread || !thread.done) return {};
      const now = new Date().toISOString();
      return {
        threads: state.threads.map((t) =>
          t.id === threadId ? { ...t, done: false, updatedAt: now } : t,
        ),
      };
    }),
  starThread: (threadId) =>
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread || thread.starred) return {};
      return {
        threads: state.threads.map((t) => (t.id === threadId ? { ...t, starred: true } : t)),
      };
    }),
  unstarThread: (threadId) =>
    set((state) => {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread || !thread.starred) return {};
      return {
        threads: state.threads.map((t) => (t.id === threadId ? { ...t, starred: false } : t)),
      };
    }),
  purgeStaleArchivedThreads: (maxAgeDays) =>
    set((state) => {
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const nextThreads = state.threads.filter(
        (t) => !t.archived || new Date(t.updatedAt).getTime() > cutoff,
      );
      if (nextThreads.length === state.threads.length) return {};
      return { threads: nextThreads };
    }),
  archiveOldDoneThreads: (maxAgeDays) =>
    set((state) => {
      if (maxAgeDays <= 0) return {};
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      let changed = false;
      const visiblePanes =
        state.view.kind === "thread" ? new Set(state.view.panes) : new Set<string>();

      const threads = state.threads.map((t) => {
        if (!t.done || t.archived || t.starred) return t;
        if (new Date(t.updatedAt).getTime() > cutoff) return t;
        changed = true;
        return { ...t, archived: true };
      });

      if (!changed) return {};

      let nextView = state.view;
      if (state.view.kind === "thread") {
        for (const t of threads) {
          if (t.archived && visiblePanes.has(t.id) && nextView.kind === "thread") {
            nextView = removePaneFromView(nextView, t.id);
          }
        }
      }

      return { threads, view: nextView };
    }),
  markThreadExited: (threadId) =>
    set((state) => {
      let changed = false;

      const threads: Thread[] = state.threads.map((thread): Thread => {
        if (thread.id !== threadId) {
          return thread;
        }

        if (thread.status === "inactive" && thread.attention === "none") {
          return thread;
        }

        changed = true;
        return {
          ...thread,
          status: "inactive",
          attention: "none",
          threadStatusSource: undefined,
        };
      });

      return changed
        ? {
            threads,
            pendingServerRequests: state.pendingServerRequests.filter(
              (request) => request.threadId !== threadId,
            ),
          }
        : {
            pendingServerRequests: state.pendingServerRequests.filter(
              (request) => request.threadId !== threadId,
            ),
          };
    }),
  touchThread: (threadId) =>
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.id === threadId ? { ...thread, updatedAt: new Date().toISOString() } : thread,
      ),
    })),
  reconcileRuntimeSnapshots: (snapshots) =>
    set((state) => {
      const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.threadId, snapshot]));
      let changed = false;

      const threads = state.threads.map((thread) => {
        const snapshot = snapshotsById.get(thread.id);

        if (snapshot) {
          const sessionRefChanged =
            (thread.sessionRef?.providerSessionId ?? "") !==
              (snapshot.sessionRef?.providerSessionId ?? "") ||
            (thread.sessionRef?.discoveredAt ?? "") !== (snapshot.sessionRef?.discoveredAt ?? "");

          const nextConfig =
            thread.presentationMode === "gui"
              ? (snapshot.config ?? thread.config)
              : stripPlanMode(snapshot.config ?? thread.config);

          if (
            thread.status === snapshot.status &&
            thread.attention === snapshot.attention &&
            isThreadConfigEqual(thread.config, nextConfig) &&
            thread.canResumeWithConfig === snapshot.canResumeWithConfig &&
            thread.threadStatusSource === snapshot.threadStatusSource &&
            !sessionRefChanged
          ) {
            return thread;
          }

          changed = true;
          return {
            ...thread,
            status: snapshot.status,
            attention: snapshot.attention,
            config: nextConfig,
            canResumeWithConfig: snapshot.canResumeWithConfig,
            ...(snapshot.threadStatusSource !== undefined
              ? { threadStatusSource: snapshot.threadStatusSource }
              : {}),
            ...(snapshot.sessionRef ? { sessionRef: snapshot.sessionRef } : {}),
          };
        }

        if (
          thread.status === "inactive" ||
          thread.status === "error" ||
          thread.status === "launching"
        ) {
          return thread;
        }

        changed = true;
        return {
          ...thread,
          status: "inactive" as ThreadStatus,
          attention: "none" as ThreadAttention,
        };
      });

      return changed ? { threads } : {};
    }),
  reorderThreads: (sourceId, targetId, placement) =>
    set((state) => {
      const threads = reorderThreadsInProject(state.threads, sourceId, targetId, placement);

      if (threads === state.threads) {
        return {};
      }

      return { threads };
    }),
  reorderThreadBlock: (blockIds, targetId, placement) =>
    set((state) => {
      const threads = reorderThreadBlockInProject(state.threads, blockIds, targetId, placement);

      if (threads === state.threads) {
        return {};
      }

      return { threads };
    }),
});

export type { ThreadServerRequestId };
