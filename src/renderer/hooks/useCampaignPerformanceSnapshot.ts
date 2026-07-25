import { usePerformanceSnapshotStore } from "@/renderer/state/performanceSnapshotStore";

/**
 * Returns the latest chat-written performance snapshot for a campaign project.
 * Updates arrive via main-process IPC (`campaignPerformanceSnapshotChanged`).
 */
export function useCampaignPerformanceSnapshot(projectId: string | undefined) {
  return usePerformanceSnapshotStore((state) =>
    projectId ? state.byProject[projectId] : undefined,
  );
}
