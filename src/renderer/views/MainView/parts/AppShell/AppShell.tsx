import { createContext, type ReactNode, useContext, useRef } from "react";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SIDEBAR_MIN_WIDTH, useResizablePanels } from "./parts/useResizablePanels";
import { SIDEBAR_COLLAPSED_WIDTH, useSidebarOverlay } from "./parts/useSidebarOverlay";
import { RightAsideSlot } from "./parts/RightAsideSlot";
import { GitAsideSlot } from "./parts/GitAsideSlot";

interface SidebarContextValue {
  isCollapsed: boolean;
  isOverlay: boolean;
  collapse: () => void;
  expand: () => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  isCollapsed: false,
  isOverlay: false,
  collapse: () => {},
  expand: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function AppShell(props: {
  sidebar: ReactNode;
  content: ReactNode;
  sidebarHeader?: ReactNode;
  collapsedSidebarHeader?: ReactNode;
  contentHeader?: ReactNode;
  rightPanel?: ReactNode;
  gitPanel?: ReactNode;
  onRequestClosePanels?: () => void;
}) {
  const {
    sidebar,
    content,
    sidebarHeader,
    collapsedSidebarHeader,
    contentHeader,
    rightPanel,
    gitPanel,
  } = props;
  const terminalPosition = useSharedSettings((s) => s.terminalPosition);

  const mainRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelInnerRef = useRef<HTMLDivElement>(null);
  const gitPanelRef = useRef<HTMLDivElement>(null);
  const gitPanelInnerRef = useRef<HTMLDivElement>(null);

  const {
    sidebarWidth,
    panelWidth,
    panelHeight,
    gitPanelWidth,
    resizeTarget,
    handleSidebarResizeStart,
    handlePanelResizeStart,
    handlePanelBottomResizeStart,
    handleGitPanelResizeStart,
  } = useResizablePanels({
    sidebarRef,
    panelRef,
    panelInnerRef,
    gitPanelRef,
    gitPanelInnerRef,
  });

  const {
    isCollapsed,
    isOverlay,
    closingOverlay,
    overlayReady,
    skipTransitionRef,
    collapse,
    expand,
  } = useSidebarOverlay({
    sidebarWidth,
    shellRef,
    mainRef,
    ...(props.onRequestClosePanels ? { onRequestClosePanels: props.onRequestClosePanels } : {}),
  });

  const displayWidth = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const isResizing = resizeTarget !== null;
  const isBottom = terminalPosition === "bottom";

  const hasHeaders = sidebarHeader != null || contentHeader != null;

  return (
    <SidebarContext.Provider value={{ isCollapsed, isOverlay, collapse, expand }}>
      <div
        ref={shellRef}
        className={`lightcode-shell flex h-full min-h-0 overflow-hidden bg-background text-foreground ${isResizing ? "select-none" : ""}`}
        style={hasHeaders ? { paddingTop: 0 } : undefined}
      >
        {!hasHeaders && <div aria-hidden="true" className="lightcode-drag-region" />}

        {isOverlay && (
          <div
            className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ${closingOverlay ? "opacity-0" : "opacity-100"}`}
            onClick={collapse}
            aria-hidden="true"
          />
        )}

        {isOverlay && (
          <div
            className={`shrink-0 ${!hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`}
            style={{ width: SIDEBAR_COLLAPSED_WIDTH, minWidth: SIDEBAR_COLLAPSED_WIDTH }}
          />
        )}

        <aside
          ref={sidebarRef}
          className={`flex min-h-0 flex-col overflow-hidden ${
            isOverlay
              ? `fixed inset-y-0 left-0 z-40 border-r border-[color:var(--border)] bg-background shadow-2xl transition-transform duration-200 ${closingOverlay || !overlayReady ? "-translate-x-full" : "translate-x-0"}`
              : `relative ${!hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)] border-r border-[color:var(--border)]" : ""}`
          } ${!isResizing && !isOverlay && !skipTransitionRef.current ? "transition-[width,min-width] duration-200" : ""}`}
          style={{ width: displayWidth, minWidth: displayWidth }}
        >
          {sidebarHeader && (
            <div
              className={`lightcode-overlay-header flex shrink-0 items-center gap-3 px-4 ${isOverlay ? "bg-background" : "bg-[var(--content-background)]"}`}
              style={{
                height: "env(titlebar-area-height, 32px)",
                ...(isCollapsed && !closingOverlay ? {} : { minWidth: SIDEBAR_MIN_WIDTH }),
              }}
            >
              {isCollapsed && !closingOverlay ? collapsedSidebarHeader : sidebarHeader}
            </div>
          )}
          <div
            className={`min-h-0 flex-1 overflow-hidden ${hasHeaders ? `mb-2 ${!isOverlay ? "border-r border-[color:var(--border)]" : ""}` : ""}`}
          >
            {sidebar}
          </div>
        </aside>

        {!isCollapsed && !isOverlay && (
          <div
            className={`lightcode-resize-handle ${!hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`}
            style={
              hasHeaders
                ? {
                    marginTop: "env(titlebar-area-height, 32px)",
                    marginBottom: "0.5rem",
                  }
                : undefined
            }
            onMouseDown={handleSidebarResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {contentHeader && (
            <div
              className="lightcode-overlay-header flex shrink-0 items-center gap-3 bg-[var(--content-background)] px-4"
              style={{
                height: "env(titlebar-area-height, 32px)",
                paddingRight:
                  "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))",
              }}
            >
              {contentHeader}
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              className={`relative flex min-h-0 min-w-0 flex-1 overflow-hidden ${isBottom && rightPanel ? "flex-col" : ""}`}
            >
              <main
                ref={mainRef}
                className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden"
              >
                <div className="relative h-full min-h-0">{content}</div>
              </main>

              {rightPanel ? (
                <RightAsideSlot
                  rightPanel={rightPanel}
                  isBottom={isBottom}
                  panelWidth={panelWidth}
                  panelHeight={panelHeight}
                  isResizing={isResizing}
                  onResizeStart={handlePanelResizeStart}
                  onResizeBottomStart={handlePanelBottomResizeStart}
                  panelRef={panelRef}
                  panelInnerRef={panelInnerRef}
                />
              ) : null}
            </div>

            {gitPanel ? (
              <GitAsideSlot
                gitPanel={gitPanel}
                gitPanelWidth={gitPanelWidth}
                isResizing={isResizing}
                onResizeStart={handleGitPanelResizeStart}
                panelRef={gitPanelRef}
                panelInnerRef={gitPanelInnerRef}
              />
            ) : null}
          </div>
        </div>

        {isResizing && (
          <div
            className={`fixed inset-0 z-50 ${resizeTarget === "panel-bottom" ? "cursor-row-resize" : "cursor-col-resize"}`}
          />
        )}
      </div>
    </SidebarContext.Provider>
  );
}
