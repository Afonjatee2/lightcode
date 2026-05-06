import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { isMac, isWindows } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SIDEBAR_MIN_WIDTH, useResizablePanels } from "./parts/useResizablePanels";
import { SIDEBAR_COLLAPSED_WIDTH, useSidebarOverlay } from "./parts/useSidebarOverlay";
import { AsideSlot } from "./parts/AsideSlot";
import { usePanelVisibility } from "./parts/usePanelVisibility";

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
  const resizeOverlayRef = useRef<HTMLDivElement>(null);
  // Keep the hover accent off the CSS `:has()` path so dragging the sidebar stays cheap.
  const [isSidebarHandleHovered, setIsSidebarHandleHovered] = useState(false);

  const {
    sidebarWidth,
    panelWidth,
    panelHeight,
    gitPanelWidth,
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
    overlayRef: resizeOverlayRef,
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

  const { rightPanelOpen, gitPanelOpen } = usePanelVisibility();
  const displayWidth = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const isBottom = terminalPosition === "bottom";
  const sidebarDividerColorClass =
    isSidebarHandleHovered && !isOverlay
      ? "border-[color:var(--accent)]"
      : "border-[color:var(--border)]";

  const hasHeaders = sidebarHeader != null || contentHeader != null;
  // Windows: stop the sidebar divider below the header so it doesn't run through the title row.
  // macOS keeps the full-height border because the header sits inside the hidden-inset titlebar.
  const sidebarDividerBelowHeader = hasHeaders && !isOverlay && !isMac();

  return (
    <SidebarContext.Provider value={{ isCollapsed, isOverlay, closingOverlay, collapse, expand }}>
      <div
        ref={shellRef}
        className="lightcode-shell flex h-full min-h-0 overflow-hidden bg-background text-foreground"
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
              : `relative ${
                  sidebarDividerBelowHeader ? "" : `border-r ${sidebarDividerColorClass}`
                } ${!hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`
          } ${!isOverlay && !skipTransitionRef.current ? "transition-[width,min-width,border-color] duration-200" : ""}`}
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
          <div
            className={`lightcode-sidebar-body min-h-0 flex-1 overflow-hidden ${
              sidebarDividerBelowHeader ? `border-r ${sidebarDividerColorClass}` : ""
            }`}
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
                    // When there is a sidebar header but no center content header, main + right start
                    // at the top; align the handle to y=0 so it stays beside the top title row.
                    marginTop: contentHeader != null ? "env(titlebar-area-height, 32px)" : 0,
                    marginBottom: "0.25rem",
                  }
                : undefined
            }
            onMouseEnter={() => setIsSidebarHandleHovered(true)}
            onMouseLeave={() => setIsSidebarHandleHovered(false)}
            onMouseDown={(event) => {
              setIsSidebarHandleHovered(false);
              handleSidebarResizeStart(event);
            }}
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
                paddingRight: isWindows()
                  ? "max(calc(1rem + 4px), calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 4px))"
                  : "max(1rem, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))",
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
                <AsideSlot
                  orientation={isBottom ? "horizontal" : "vertical"}
                  isOpen={rightPanelOpen}
                  targetWidth={panelWidth}
                  targetHeight={panelHeight}
                  onResizeStart={isBottom ? handlePanelBottomResizeStart : handlePanelResizeStart}
                  panelRef={panelRef}
                  panelInnerRef={panelInnerRef}
                  ariaLabel="Resize terminal panel"
                >
                  {rightPanel}
                </AsideSlot>
              ) : null}
            </div>

            {gitPanel ? (
              <AsideSlot
                orientation="vertical"
                isOpen={gitPanelOpen}
                targetWidth={gitPanelWidth}
                onResizeStart={handleGitPanelResizeStart}
                panelRef={gitPanelRef}
                panelInnerRef={gitPanelInnerRef}
                ariaLabel="Resize git panel"
              >
                {gitPanel}
              </AsideSlot>
            ) : null}
          </div>
        </div>

        <div
          ref={resizeOverlayRef}
          aria-hidden="true"
          className="fixed inset-0 z-50"
          style={{ display: "none" }}
        />
      </div>
    </SidebarContext.Provider>
  );
}
