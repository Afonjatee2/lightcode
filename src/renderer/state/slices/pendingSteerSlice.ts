import type { PendingSteerState } from "@/shared/contracts";
import type { SliceCreator } from "./shared";

export interface PendingSteerSlice {
  /**
   * Single staged steer message per thread. Mirrors the supervisor's
   * `pendingSteer` slot via the `thread-pending-steer` event. Empty entry
   * (or undefined) means the slot is clear.
   */
  pendingSteerByThreadId: Record<string, PendingSteerState>;
  setPendingSteer(threadId: string, pending: PendingSteerState | null): void;
  clearAllPendingSteer(threadId: string): void;
}

export const createPendingSteerSlice: SliceCreator<PendingSteerSlice> = (set) => ({
  pendingSteerByThreadId: {},
  setPendingSteer: (threadId, pending) =>
    set((state) => {
      const current = state.pendingSteerByThreadId[threadId];
      if (pending === null) {
        if (!current) return state;
        const next = { ...state.pendingSteerByThreadId };
        delete next[threadId];
        return { pendingSteerByThreadId: next };
      }
      if (
        current &&
        current.id === pending.id &&
        current.prompt === pending.prompt &&
        current.stagedAt === pending.stagedAt
      ) {
        return state;
      }
      return {
        pendingSteerByThreadId: {
          ...state.pendingSteerByThreadId,
          [threadId]: pending,
        },
      };
    }),
  clearAllPendingSteer: (threadId) =>
    set((state) => {
      if (!state.pendingSteerByThreadId[threadId]) return state;
      const next = { ...state.pendingSteerByThreadId };
      delete next[threadId];
      return { pendingSteerByThreadId: next };
    }),
});
