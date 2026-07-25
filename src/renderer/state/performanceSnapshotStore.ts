import { create } from "zustand";
import type { PerformanceSnapshot } from "@/shared/contracts/campaign/performanceSnapshot";

interface PerformanceSnapshotStore {
  byProject: Record<string, PerformanceSnapshot | null | undefined>;
  setSnapshot: (projectId: string, snapshot: PerformanceSnapshot | null) => void;
  clearProject: (projectId: string) => void;
  resetSession: () => void;
}

export const usePerformanceSnapshotStore = create<PerformanceSnapshotStore>((set) => ({
  byProject: {},
  setSnapshot: (projectId, snapshot) =>
    set((state) => ({
      byProject: { ...state.byProject, [projectId]: snapshot },
    })),
  clearProject: (projectId) =>
    set((state) => {
      const next = { ...state.byProject };
      delete next[projectId];
      return { byProject: next };
    }),
  resetSession: () => set({ byProject: {} }),
}));

export function selectPerformanceSnapshot(
  projectId: string | undefined,
): PerformanceSnapshot | null | undefined {
  if (!projectId) return undefined;
  return usePerformanceSnapshotStore.getState().byProject[projectId];
}
