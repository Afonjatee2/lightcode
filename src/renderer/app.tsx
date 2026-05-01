import { toast } from "@heroui/react";
import { useEffect } from "react";
import { PixelLoader } from "./components/common";
import { msg } from "@/shared/messages";
import { readBridge } from "./bridge";
import {
  handleThreadStateNotification,
  shouldInspectThreadStateForNotification,
} from "./notifications";

import { useAppStore } from "./state/appStore";
import { useAgentStatusesStore } from "./state/agentStatusesStore";
import { useUpdateStore } from "./state/updateStore";

import { useAppHydration } from "@/renderer/hooks/useAppHydration";
import { AppProvider } from "./components/ui/provider";
import { MainView } from "@/renderer/views/MainView/MainView";

// ── Module-level IPC listeners ──────────────────────────────────
// Subscribes to supervisor events as soon as the module loads,
// completely outside React's lifecycle.  This guarantees events are
// never missed due to useEffect timing, StrictMode double-mounts,
// or startTransition batching.
//
// Both subscribe calls return unsubscribe functions which we store
// so that Vite HMR can tear them down before re-executing the module.

let threadStateNotificationsArmed = false;

const unsubSupervisor = readBridge().onSupervisorEvent((event) => {
  if ("threadId" in event && event.threadId.startsWith("shell:")) {
    return;
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
  if (event.type === "thread-server-request") {
    useAppStore.getState().addThreadServerRequest({
      threadId: event.threadId,
      requestId: event.requestId,
      method: event.method,
      params: event.params,
    });
  }
  if (event.type === "thread-reset") {
    useAppStore.getState().clearThreadServerRequests(event.threadId);
  }
  if (event.type === "thread-exited") {
    useAppStore.getState().markThreadExited(event.threadId);
  }
  if (event.type === "windows-agent-statuses") {
    console.log(`[renderer] event: windows-agent-statuses (${event.statuses.length} agents)`);
    useAgentStatusesStore.getState().setAgentStatuses(event.statuses);
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubSupervisor();
    unsubUpdate();
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
    </AppProvider>
  );
}
