import { startTransition, useEffect, useState } from "react";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

interface IdleCallbackHandle {
  cancel: () => void;
}

function scheduleIdle(work: () => void): IdleCallbackHandle {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => work(), { timeout: 5000 });
    return { cancel: () => window.cancelIdleCallback?.(id) };
  }
  const timeoutId = setTimeout(work, 2000);
  return { cancel: () => clearTimeout(timeoutId) };
}

export function useAppHydration() {
  const markThreadsInactiveOnLaunch = useAppStore((state) => state.markThreadsInactiveOnLaunch);
  const purgeStaleArchivedThreads = useAppStore((state) => state.purgeStaleArchivedThreads);
  const archiveOldDoneThreads = useAppStore((state) => state.archiveOldDoneThreads);
  const reconcileRuntimeSnapshots = useAppStore((state) => state.reconcileRuntimeSnapshots);
  const updateThreadRuntime = useAppStore((state) => state.updateThreadRuntime);
  const view = useAppStore((state) => state.view);

  const [initialLoading, setInitialLoading] = useState(true);
  const [storeHydrated, setStoreHydrated] = useState(() => useAppStore.persist.hasHydrated());
  const [loadT0] = useState(() => Date.now());

  useEffect(() => {
    const unsubscribeHydrate = useAppStore.persist.onHydrate(() => {
      setStoreHydrated(false);
    });
    const unsubscribeFinishHydration = useAppStore.persist.onFinishHydration(() => {
      setStoreHydrated(true);
    });

    setStoreHydrated(useAppStore.persist.hasHydrated());

    return () => {
      unsubscribeHydrate();
      unsubscribeFinishHydration();
    };
  }, []);

  useEffect(() => {
    if (!storeHydrated) {
      console.log(`[renderer] +${Date.now() - loadT0}ms: waiting for store hydration`);
      return;
    }

    let isActive = true;
    const restoredView = useAppStore.getState().view;
    console.log(
      `[renderer] +${Date.now() - loadT0}ms: store hydrated, view=${JSON.stringify(restoredView)}, ${useAppStore.getState().projects.length} projects, ${useAppStore.getState().threads.length} threads`,
    );

    startTransition(() => {
      markThreadsInactiveOnLaunch();
      purgeStaleArchivedThreads(30);
      console.log(`[renderer] +${Date.now() - loadT0}ms: initialLoading = false`);
      setInitialLoading(false);
    });

    const idleHandle = scheduleIdle(() => {
      if (!isActive) return;
      const days = useSharedSettings.getState().autoArchiveDoneAfterDays;
      if (days > 0) {
        startTransition(() => {
          archiveOldDoneThreads(days);
        });
      }
      // Warm the markdown renderer chunk so the first assistant reply renders
      // markdown without a Suspense flicker. Heavy deps (Streamdown + remark)
      // stay out of the synchronous startup path.
      void import("@/renderer/components/thread/ChatPane/parts/items/ItemMarkdownInner");
    });

    void readBridge()
      .getThreadSnapshots()
      .then((snapshots) => {
        if (!isActive) {
          return;
        }

        const currentView = useAppStore.getState().view;
        const selectedIds = new Set(currentView.kind === "thread" ? currentView.panes : []);
        const storeThreadIds = new Set(useAppStore.getState().threads.map((t) => t.id));

        for (const snapshot of snapshots) {
          if (!selectedIds.has(snapshot.threadId) && storeThreadIds.has(snapshot.threadId)) {
            void readBridge()
              .closeThread({ threadId: snapshot.threadId })
              .catch(() => undefined);
          }
        }

        startTransition(() => {
          reconcileRuntimeSnapshots(
            selectedIds.size > 0 ? snapshots.filter((s) => selectedIds.has(s.threadId)) : [],
          );
        });
      });

    return () => {
      isActive = false;
      idleHandle.cancel();
    };
  }, [
    loadT0,
    markThreadsInactiveOnLaunch,
    purgeStaleArchivedThreads,
    archiveOldDoneThreads,
    reconcileRuntimeSnapshots,
    storeHydrated,
  ]);

  useEffect(() => {
    if (!storeHydrated || initialLoading) {
      return;
    }

    let cancelled = false;
    void readBridge()
      .getThreadSnapshots()
      .then((snapshots) => {
        if (cancelled || snapshots.length === 0) {
          return;
        }
        for (const snapshot of snapshots) {
          updateThreadRuntime(snapshot.threadId, snapshot);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [storeHydrated, initialLoading, updateThreadRuntime, view]);

  return { initialLoading, storeHydrated, loadT0 };
}
