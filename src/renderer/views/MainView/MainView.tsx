import { startTransition, useEffect } from "react";
import { buildPaneLayoutFromLegacy } from "@/shared/paneLayout";
import { readBridge } from "@/renderer/bridge";

import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { AppDndProvider } from "@/renderer/dnd";
import { useMainViewActions } from "@/renderer/views/MainView/parts/useMainViewActions";
import { SidebarActionsProvider } from "@/renderer/views/MainView/parts/Sidebar/parts/SidebarActionsContext";

import { useKeyboardShortcuts } from "@/renderer/hooks/useKeyboardShortcuts";
import { useWslDetection } from "@/renderer/hooks/useWslDetection";
import { useGitRefresh } from "@/renderer/hooks/useGitRefresh";
import { useThreadLifecycle } from "@/renderer/hooks/useThreadLifecycle";
import { useDndHandlers } from "@/renderer/hooks/useDndHandlers";

import { AppOverlays } from "@/renderer/views/MainView/parts/AppOverlays";
import { WorktreeDeleteDialogs } from "@/renderer/views/MainView/parts/WorktreeDeleteDialogs";
import { MainPageLayout, StalePanelCleanup } from "@/renderer/views/MainView/parts/MainPageLayout";

const EMPTY_PANES: string[] = [];

export function MainView(props: { storeHydrated: boolean; loadT0: number }) {
  const { storeHydrated, loadT0 } = props;
  const projects = useAppStore((state) => state.projects);
  const view = useAppStore((state) => state.view);
  const openHome = useAppStore((state) => state.openHome);

  useThreadLifecycle(storeHydrated);
  const { wslAvailable } = useWslDetection(storeHydrated);
  useKeyboardShortcuts();
  useGitRefresh(projects, storeHydrated);

  const { handleSortEnd, handlePaneDrop } = useDndHandlers();

  const { sidebarActions } = useMainViewActions();

  const wslProjectDistrosKey = [
    ...new Set(
      projects.flatMap((project) =>
        project.location.kind === "wsl" ? [project.location.distro] : [],
      ),
    ),
  ]
    .sort()
    .join("\0");

  useEffect(() => {
    if (!storeHydrated) {
      return;
    }

    // Triggers detection in the supervisor. When cache is available the RPC
    // resolves immediately with the previously-detected statuses so the first
    // ThreadDraft render has real agents instead of the empty initial state.
    // Fresh detection results still arrive via events
    // (windows-agent-statuses, wsl-agent-statuses).
    void readBridge()
      .getAgentStatuses(wslProjectDistrosKey ? wslProjectDistrosKey.split("\0") : [])
      .then((response) => {
        if (response.fromCache) {
          useAgentStatusesStore.getState().hydrateFromCache({
            windows: response.windows,
            wsl: response.wsl,
          });
        }
      })
      .catch(() => undefined);
  }, [storeHydrated, wslProjectDistrosKey]);

  const paneThreadIds = view.kind === "thread" ? view.panes : EMPTY_PANES;

  console.log(`[renderer] +${Date.now() - loadT0}ms: rendering main UI`);
  return (
    <>
      <AppDndProvider
        onSidebarSortEnd={handleSortEnd}
        onPaneDrop={handlePaneDrop}
        paneThreadIds={paneThreadIds}
        paneLayout={
          view.kind === "thread"
            ? (view.paneLayout ?? buildPaneLayoutFromLegacy(view.panes, view.rowLayout))
            : buildPaneLayoutFromLegacy(["__placeholder__"])
        }
      >
        <SidebarActionsProvider value={sidebarActions}>
          <MainPageLayout
            wslAvailable={wslAvailable}
            onTitleClick={() => startTransition(() => openHome())}
          />
        </SidebarActionsProvider>
      </AppDndProvider>
      <StalePanelCleanup />
      <AppOverlays />
      <WorktreeDeleteDialogs />
    </>
  );
}
