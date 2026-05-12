import { toast } from "@heroui/react";
import { useEffect } from "react";
import { PixelLoader } from "./components/common";
import { msg } from "@/shared/messages";
import type { RuntimeEvent } from "@/shared/contracts";
import { readBridge } from "./bridge";
import {
  handleThreadStateNotification,
  shouldInspectThreadStateForNotification,
} from "./notifications";

import { useAppStore } from "./state/appStore";
import { useAgentStatusesStore } from "./state/agentStatusesStore";
import { useUpdateStore } from "./state/updateStore";
import { installRuntimeItemsPersister } from "./state/chatRuntimePersister";
import { clearRuntimeItemStoreSelectorCacheForThread } from "./components/thread/ChatPane/chatPaneSelectors";

import { useAppHydration } from "@/renderer/hooks/useAppHydration";
import { AppProvider } from "./components/ui/provider";
import { MainView } from "@/renderer/views/MainView/MainView";
import { CommandPalette } from "@/renderer/commands/CommandPalette";

// ── Module-level IPC listeners ──────────────────────────────────
// Subscribes to supervisor events as soon as the module loads,
// completely outside React's lifecycle.  This guarantees events are
// never missed due to useEffect timing, StrictMode double-mounts,
// or startTransition batching.
//
// Both subscribe calls return unsubscribe functions which we store
// so that Vite HMR can tear them down before re-executing the module.

let threadStateNotificationsArmed = false;

// ── Runtime event rAF batcher ───────────────────────────────────
// With 6-8 concurrent streaming chats, the supervisor produces ~500
// `thread-runtime-event(s)` IPC messages per second. Applying each one
// synchronously triggers a Zustand `set()` and re-evaluates every subscribed
// selector across all mounted ChatPanes. Coalescing into one apply per
// animation frame caps store mutation rate to ~60/sec regardless of incoming
// event rate, while preserving per-thread event order. Non-runtime events
// (thread-state, reset, exit, …) flush the queue before applying so they
// observe a consistent state.
const pendingRuntimeEvents = new Map<string, RuntimeEvent[]>();
let runtimeFlushHandle: number | null = null;

function flushPendingRuntimeEvents(): void {
  runtimeFlushHandle = null;
  if (pendingRuntimeEvents.size === 0) return;
  const store = useAppStore.getState();
  for (const [threadId, events] of pendingRuntimeEvents) {
    store.applyRuntimeEvents(threadId, events);
  }
  pendingRuntimeEvents.clear();
}

function enqueueRuntimeEvents(threadId: string, events: readonly RuntimeEvent[]): void {
  if (events.length === 0) return;
  const existing = pendingRuntimeEvents.get(threadId);
  if (existing) {
    for (const evt of events) existing.push(evt);
  } else {
    pendingRuntimeEvents.set(threadId, [...events]);
  }
  if (runtimeFlushHandle === null) {
    runtimeFlushHandle = requestAnimationFrame(flushPendingRuntimeEvents);
  }
}

function flushPendingRuntimeEventsSync(): void {
  if (runtimeFlushHandle !== null) {
    cancelAnimationFrame(runtimeFlushHandle);
    runtimeFlushHandle = null;
  }
  if (pendingRuntimeEvents.size > 0) flushPendingRuntimeEvents();
}

const unsubSupervisor = readBridge().onSupervisorEvent((event) => {
  if ("threadId" in event && event.threadId.startsWith("shell:")) {
    return;
  }

  if (event.type === "thread-runtime-event") {
    enqueueRuntimeEvents(event.threadId, [event.event]);
    return;
  }
  if (event.type === "thread-runtime-events") {
    enqueueRuntimeEvents(event.threadId, event.events);
    return;
  }
  if (event.type === "thread-runtime-events-multi") {
    for (const batch of event.batches) {
      enqueueRuntimeEvents(batch.threadId, batch.events);
    }
    return;
  }

  // Non-runtime event: drain pending runtime events first so the handler below
  // observes the same ordering callers expect from the IPC stream.
  if ("threadId" in event && pendingRuntimeEvents.has(event.threadId)) {
    flushPendingRuntimeEventsSync();
  }

  if (event.type === "thread-state") {
    const shouldCheckNotifications =
      threadStateNotificationsArmed && shouldInspectThreadStateForNotification();
    const appStore = useAppStore.getState();
    const oldThread = shouldCheckNotifications
      ? appStore.threads.find((t) => t.id === event.threadId)
      : undefined;
    appStore.updateThreadRuntime(event.threadId, event);
    if (shouldCheckNotifications) {
      const newThread = useAppStore.getState().threads.find((t) => t.id === event.threadId);
      handleThreadStateNotification(event, oldThread, newThread);
    }
  }
  if (event.type === "thread-pending-steer") {
    useAppStore.getState().setPendingSteer(event.threadId, event.pending);
  }
  if (event.type === "thread-reset") {
    pendingRuntimeEvents.delete(event.threadId);
    useAppStore.getState().clearThreadRuntimeEvents(event.threadId);
    useAppStore.getState().clearAllPendingSteer(event.threadId);
    clearRuntimeItemStoreSelectorCacheForThread(event.threadId);
  }
  if (event.type === "thread-exited") {
    useAppStore.getState().markThreadExited(event.threadId);
    useAppStore.getState().clearAllPendingSteer(event.threadId);
  }
  if (event.type === "agent-detected") {
    useAgentStatusesStore.getState().pushDiscoveredAgent(event.status);
  }
  if (event.type === "windows-agent-statuses") {
    console.log(`[renderer] event: windows-agent-statuses (${event.statuses.length} agents)`);
    const store = useAgentStatusesStore.getState();
    if (store.inFirstLaunchDiscovery) {
      const statuses = event.statuses;
      setTimeout(() => {
        useAgentStatusesStore.getState().setAgentStatuses(statuses);
      }, 1000);
    } else {
      store.setAgentStatuses(event.statuses);
    }
  }
  if (event.type === "wsl-agent-statuses") {
    console.log(`[renderer] event: wsl-agent-statuses (${event.statuses.length} agents)`);
    useAgentStatusesStore.getState().setWslAgentStatuses(event.statuses);
  }
});

const unsubUpdate = readBridge().onUpdateStatus((status) => {
  const store = useUpdateStore.getState();
  switch (status.type) {
    case "checking":
      store.setChecking();
      break;
    case "update-available":
      store.beginUpdateDownload(status.version);
      break;
    case "update-not-available":
      store.setNotAvailable();
      toast.success("You're on the latest version.");
      break;
    case "downloading":
      store.setDownloading(status.percent, {
        transferred: status.transferred,
        total: status.total,
        bytesPerSecond: status.bytesPerSecond,
      });
      break;
    case "downloaded":
      store.setDownloaded(status.version);
      break;
    case "error":
      store.setError(status.message);
      toast.danger(msg("update.error", { detail: status.message }));
      break;
  }
});

const uninstallRuntimePersister = installRuntimeItemsPersister();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubSupervisor();
    unsubUpdate();
    uninstallRuntimePersister();
    if (runtimeFlushHandle !== null) {
      cancelAnimationFrame(runtimeFlushHandle);
      runtimeFlushHandle = null;
    }
    pendingRuntimeEvents.clear();
  });
}

export function App() {
  const { initialLoading, storeHydrated, loadT0 } = useAppHydration();

  useEffect(() => {
    if (initialLoading) {
      threadStateNotificationsArmed = false;
      return;
    }

    threadStateNotificationsArmed = true;
    return () => {
      threadStateNotificationsArmed = false;
    };
  }, [initialLoading]);

  if (initialLoading) {
    console.log(
      `[renderer] +${Date.now() - loadT0}ms: rendering spinner (hydrated=${storeHydrated})`,
    );
    return (
      <AppProvider>
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
          <div className="flex flex-col items-center gap-4">
            <PixelLoader size="lg" />
            <p className="text-sm text-muted">Loading&hellip;</p>
          </div>
        </div>
      </AppProvider>
    );
  }

  return (
    <AppProvider>
      <MainView storeHydrated={storeHydrated} loadT0={loadT0} />
      <CommandPalette />
    </AppProvider>
  );
}
