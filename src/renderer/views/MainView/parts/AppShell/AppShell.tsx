import { createContext, type ReactNode, useContext, useRef } from "react";
import { isMac } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SIDEBAR_MIN_WIDTH, useResizablePanels } from "./parts/useResizablePanels";
import { SIDEBAR_COLLAPSED_WIDTH, useSidebarOverlay } from "./parts/useSidebarOverlay";
import { RightAsideSlot } from "./parts/RightAsideSlot";
import { GitAsideSlot } from "./parts/GitAsideSlot";

interface SidebarContextValue {
  isCollapsed: boolean;
  isOverlay: boolean;
  /** When true, overlay sidebar is animating closed — show expanded header actions in the title row. */
  closingOverlay: boolean;
  collapse: () => void;
  expand: () => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
  isCollapsed: false,
  isOverlay: false,
  closingOverlay: false,
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
  contentHeader?: ReactNode;
  rightPanel?: ReactNode;
  gitPanel?: ReactNode;
  onRequestClosePanels?: () => void;
}) {
  const { sidebar, content, sidebarHeader, contentHeader, rightPanel, gitPanel } = props;
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
    <SidebarContext.Provider value={{ isCollapsed, isOverlay, closingOverlay, collapse, expand }}>
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
              : `relative border-r border-[color:var(--border)] ${!hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`
          } ${!isResizing && !isOverlay && !skipTransitionRef.current ? "transition-[width,min-width] duration-200" : ""}`}
          style={{ width: displayWidth, minWidth: displayWidth }}
        >
          {sidebarHeader && (
            <div
              className={`lightcode-overlay-header flex shrink-0 items-center gap-3 ${
                isMac() ? "pl-3 pr-2 pt-0.5" : "px-2"
              } ${isOverlay ? "bg-background" : "bg-[var(--content-background)]"}`}
              style={{
                height: "env(titlebar-area-height, 32px)",
                ...(isCollapsed && !closingOverlay ? {} : { minWidth: SIDEBAR_MIN_WIDTH }),
              }}
            >
              {sidebarHeader}
            </div>
          )}
          <div className={`min-h-0 flex-1 overflow-hidden ${hasHeaders ? "mb-1" : ""}`}>
            {sidebar}
          </div>
        </aside>

        {!isCollapsed && !isOverlay && (
          <div
            className={`lightcode-resize-handle ${!hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`}
            style={
              hasHeaders
                ? {
                    // When there is a sidebar header but no center content header, main + right start
                    // at the top; align the handle to y=0 so it stays beside the top title row.
                    marginTop: contentHeader != null ? "env(titlebar-area-height, 32px)" : 0,
                    marginBottom: "0.25rem",
                  }
                : undefined
            }
            onMouseDown={handleSidebarResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [isolation:isolate]">
          {contentHeader && (
            <div
              className="lightcode-overlay-header flex shrink-0 items-center gap-3 bg-[var(--content-background)] px-2"
              style={{
                height: "env(titlebar-area-height, 32px)",
                paddingRight:
                  "max(1rem, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))",
              }}
            >
              {contentHeader}
            </div>
          )}

          {/* z-0 keeps main + right panel (resize handles are z-20) below the title row when rows overlap
              (subpixel or env() mismatch on macOS can otherwise paint the panel over the content header). */}
          <div className="relative z-0 flex min-h-0 min-w-0 flex-1 overflow-hidden">
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
