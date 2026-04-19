import { useEffect } from "react";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { reopenPaneThreadsIfInactive, sweepStaleThreads } from "@/renderer/actions/threadActions";
import { STALE_THREAD_SWEEP_INTERVAL_MS } from "@/renderer/utils/gitHelpers";

const EMPTY_PANES: string[] = [];

export function useThreadLifecycle(storeHydrated: boolean) {
  const staleThreadUnloadMinutes = useSharedSettings((s) => s.staleThreadUnloadMinutes);
  const currentPaneIds = useAppStore((s) =>
    s.view.kind === "thread" ? s.view.panes : EMPTY_PANES,
  );

  useEffect(() => {
    if (!storeHydrated) return;
    reopenPaneThreadsIfInactive();
  }, [currentPaneIds, storeHydrated]);

  useEffect(() => {
    if (!storeHydrated || staleThreadUnloadMinutes <= 0) {
      return;
    }

    const intervalId = setInterval(() => {
      sweepStaleThreads();
    }, STALE_THREAD_SWEEP_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [storeHydrated, staleThreadUnloadMinutes]);
}
