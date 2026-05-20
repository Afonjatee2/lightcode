import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/shallow";
import { isMac, isWindows } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import {
  collapseSidebar,
  expandSidebar,
  selectIsOverlay,
  useSidebarOverlayStore,
} from "@/renderer/state/sidebarOverlayStore";
import {
  CONTENT_MIN_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useResizablePanels,
} from "./parts/useResizablePanels";
import { SIDEBAR_COLLAPSED_WIDTH, useSidebarOverlayEffects } from "./parts/useSidebarOverlay";
import { AsideSlot } from "./parts/AsideSlot";
import { usePanelVisibility } from "./parts/usePanelVisibility";

interface SidebarContextValue {
  isCollapsed: boolean;
  isOverlay: boolean;
  closingOverlay: boolean;
  collapse: () => void;
  expand: () => void;
}

/**
 * Override slot for nested surfaces (e.g. `GitReviewPanel`) that want their
 * descendants to see a fixed "always expanded" sidebar state regardless of
 * the global one. AppShell itself does *not* mount a Provider — the global
 * path reads directly from the zustand store, so AppShell's render is not
 * coupled to collapse state.
 */
export const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Reads the sidebar state. Default path: subscribe to `sidebarOverlayStore`.
 * If a `SidebarContext.Provider` is mounted above, that override wins. Shape
 * preserved for backwards compatibility with the prior context-only API.
 */
export function useSidebar(): SidebarContextValue {
  const override = useContext(SidebarContext);
  const fromStore = useSidebarOverlayStore(
    useShallow((s) => ({
      isCollapsed: s.isCollapsed,
      isOverlay: selectIsOverlay(s),
      closingOverlay: s.closingOverlay,
      collapse: collapseSidebar,
      expand: expandSidebar,
    })),
  );
  return override ?? fromStore;
}

/**
 * Writes `data-mac-collapsed` to the shell root whenever the sidebar collapse
 * state changes — purely a side effect, renders nothing. Non-Mac is a no-op
 * (the attribute is never set), so the matching CSS rule never matches.
 */
function MacCollapsedTracker(props: {
  shellRef: RefObject<HTMLDivElement | null>;
  forceSidebarExpanded: boolean;
}) {
  const isCollapsed = useSidebarOverlayStore((s) => s.isCollapsed);
  useEffect(() => {
    if (!isMac()) return;
    const el = props.shellRef.current;
    if (!el) return;
    if (isCollapsed && !props.forceSidebarExpanded) {
      el.dataset.macCollapsed = "";
    } else {
      delete el.dataset.macCollapsed;
    }
  }, [isCollapsed, props.forceSidebarExpanded, props.shellRef]);
  return null;
}

/**
 * Drives the sidebar's `width` / `min-width` imperatively, matching the drag
 * path. Renders nothing. Subscribes to the overlay store and on every change
 * to (collapsed × overlay × sidebarWidth × skipTransition) computes the new
 * target and either snaps (initial mount, skipTransition, or already at
 * target) or runs a raf-interpolated animation.
 *
 * Invariant: this driver and `useResizablePanels.applySidebarWidth` are the
 * only two places that write `style.width` / `style.minWidth` on the aside.
 * `ShellSidebarAside` intentionally has no `width` in its inline style and no
 * width transition class — if you re-introduce either, the imperative writes
 * here will fight React's commit and the animation will jump.
 */
const SIDEBAR_WIDTH_TRANSITION_MS = 200;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

function SidebarWidthDriver(props: {
  sidebarRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  forceSidebarExpanded: boolean;
}) {
  const { sidebarRef, sidebarWidth, forceSidebarExpanded } = props;
  const isCollapsed = useSidebarOverlayStore((s) => s.isCollapsed);
  const skipTransition = useSidebarOverlayStore((s) => s.skipTransition);
  const isOverlay = useSidebarOverlayStore(selectIsOverlay);
  const effectiveIsCollapsed = forceSidebarExpanded ? false : isCollapsed;
  const effectiveIsOverlay = forceSidebarExpanded ? false : isOverlay;

  // In overlay mode the aside is `position: fixed` and slides via transform —
  // its width stays at the full sidebarWidth. In normal mode we either show
  // sidebarWidth (expanded) or SIDEBAR_COLLAPSED_WIDTH (collapsed).
  const targetWidth =
    effectiveIsCollapsed && !effectiveIsOverlay ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  const prevTargetRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const isInitial = prevTargetRef.current === null;
    prevTargetRef.current = targetWidth;

    // Snap to target without animation:
    //   - initial mount (no prior width to interpolate from)
    //   - skipTransition (the closing-overlay → collapsed snap)
    //   - already at target (e.g. drag end syncing React state with the DOM)
    const fromWidth = el.getBoundingClientRect().width;
    if (isInitial || skipTransition || Math.abs(fromWidth - targetWidth) < 0.5) {
      el.style.width = `${targetWidth}px`;
      el.style.minWidth = `${targetWidth}px`;
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / SIDEBAR_WIDTH_TRANSITION_MS);
      const eased = easeOutCubic(t);
      const w = fromWidth + (targetWidth - fromWidth) * eased;
      el.style.width = `${w}px`;
      el.style.minWidth = `${w}px`;
      if (t < 1) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        el.style.width = `${targetWidth}px`;
        el.style.minWidth = `${targetWidth}px`;
        rafIdRef.current = null;
      }
    };
    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [targetWidth, skipTransition, sidebarRef]);

  return null;
}

function ShellSidebarBackdrop(props: { forceSidebarExpanded: boolean }) {
  const closingOverlay = useSidebarOverlayStore((s) => s.closingOverlay);
  const isOverlay = useSidebarOverlayStore(selectIsOverlay);
  if (props.forceSidebarExpanded) return null;
  if (!isOverlay) return null;
  return (
    <div
      className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ${
        closingOverlay ? "opacity-0" : "opacity-100"
      }`}
      onClick={collapseSidebar}
      aria-hidden="true"
    />
  );
}

function ShellSidebarSpacer(props: { hasHeaders: boolean; forceSidebarExpanded: boolean }) {
  const isOverlay = useSidebarOverlayStore(selectIsOverlay);
  if (props.forceSidebarExpanded) return null;
  if (!isOverlay) return null;
  return (
    <div
      className={`shrink-0 ${!props.hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`}
      style={{ width: SIDEBAR_COLLAPSED_WIDTH, minWidth: SIDEBAR_COLLAPSED_WIDTH }}
    />
  );
}

function ShellSidebarAside(props: {
  sidebarRef: RefObject<HTMLDivElement | null>;
  sidebarHeader: ReactNode | undefined;
  sidebar: ReactNode;
  hasHeaders: boolean;
  isSidebarHandleHovered: boolean;
  forceSidebarExpanded: boolean;
}) {
  const {
    sidebarRef,
    sidebarHeader,
    sidebar,
    hasHeaders,
    isSidebarHandleHovered,
    forceSidebarExpanded,
  } = props;
  const isCollapsed = useSidebarOverlayStore((s) => s.isCollapsed);
  const closingOverlay = useSidebarOverlayStore((s) => s.closingOverlay);
  const overlayReady = useSidebarOverlayStore((s) => s.overlayReady);
  const isOverlay = useSidebarOverlayStore(selectIsOverlay);
  const effectiveIsCollapsed = forceSidebarExpanded ? false : isCollapsed;
  const effectiveClosingOverlay = forceSidebarExpanded ? false : closingOverlay;
  const effectiveIsOverlay = forceSidebarExpanded ? false : isOverlay;

  const sidebarDividerColorClass =
    isSidebarHandleHovered && !effectiveIsOverlay
      ? "border-[color:var(--accent)]"
      : "border-[color:var(--border)]";
  // Windows: stop the sidebar divider below the header so it doesn't run through the title row.
  // macOS keeps the full-height border because the header sits inside the hidden-inset titlebar.
  // HOWEVER, if the sidebar is too narrow (e.g. collapsed), the full-height border would run
  // directly through the macOS traffic light controls, so we push it below the header in that case.
  const sidebarDividerBelowHeader =
    hasHeaders && !effectiveIsOverlay && (!isMac() || effectiveIsCollapsed);

  // `width` and `min-width` are driven imperatively by `SidebarWidthDriver`
  // (raf-interpolated to match the drag path). React just owns the rest of
  // the className/style — keeping the border-color transition for the hover
  // accent on the resize handle, and the transform transition for overlay
  // slide in/out.
  return (
    <aside
      ref={sidebarRef}
      className={`flex min-h-0 flex-col overflow-hidden transition-[border-color] duration-200 ${
        effectiveIsOverlay
          ? `fixed inset-y-0 left-0 z-40 border-r border-[color:var(--border)] bg-background shadow-2xl transition-transform duration-200 ${
              effectiveClosingOverlay || !overlayReady ? "-translate-x-full" : "translate-x-0"
            }`
          : `relative ${
              sidebarDividerBelowHeader ? "" : `border-r ${sidebarDividerColorClass}`
            } ${!hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`
      }`}
    >
      {sidebarHeader && (
        <div
          className={`lightcode-overlay-header flex shrink-0 items-center gap-3 ${
            isMac() ? "pl-3 pr-2 pt-0.5" : "px-2"
          } ${effectiveIsOverlay ? "bg-background" : "bg-[var(--content-background)]"}`}
          style={{
            height: "env(titlebar-area-height, 32px)",
            ...(effectiveIsCollapsed && !effectiveClosingOverlay
              ? {}
              : { minWidth: SIDEBAR_MIN_WIDTH }),
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
  );
}

function ShellSidebarResizeHandle(props: {
  hasHeaders: boolean;
  hasContentHeader: boolean;
  forceSidebarExpanded: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const { isCollapsed, isOverlay } = useSidebarOverlayStore(
    useShallow((s) => ({
      isCollapsed: s.isCollapsed,
      isOverlay: selectIsOverlay(s),
    })),
  );
  const effectiveIsCollapsed = props.forceSidebarExpanded ? false : isCollapsed;
  const effectiveIsOverlay = props.forceSidebarExpanded ? false : isOverlay;
  if (effectiveIsCollapsed || effectiveIsOverlay) return null;
  return (
    <div
      className={`lightcode-resize-handle ${!props.hasHeaders ? "-mt-5 h-[calc(100%+0.75rem)]" : ""}`}
      style={
        props.hasHeaders
          ? {
              // When there is a sidebar header but no center content header, main + right start
              // at the top; align the handle to y=0 so it stays beside the top title row.
              marginTop: props.hasContentHeader ? "env(titlebar-area-height, 32px)" : 0,
              marginBottom: "0.25rem",
            }
          : undefined
      }
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      onMouseDown={props.onMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
    />
  );
}

export function AppShell(props: {
  sidebar: ReactNode;
  content: ReactNode;
  sidebarHeader?: ReactNode;
  contentHeader?: ReactNode;
  rightPanel?: ReactNode;
  gitPanel?: ReactNode;
  forceSidebarExpanded?: boolean;
  onRequestClosePanels?: () => void;
}) {
  const { sidebar, content, sidebarHeader, contentHeader, rightPanel, gitPanel } = props;
  const forceSidebarExpanded = props.forceSidebarExpanded === true;
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
    cancelActiveResize,
    updatePanelWidth,
    updateGitPanelWidth,
  } = useResizablePanels({
    sidebarRef,
    panelRef,
    panelInnerRef,
    gitPanelRef,
    gitPanelInnerRef,
    mainRef,
    overlayRef: resizeOverlayRef,
  });

  // When content shrinks past the threshold while the user is mid-drag, we
  // both hide panels and end the drag — otherwise the panel disappears but
  // the mouse is still captured and keeps resizing an invisible target.
  // We also shrink the panel widths so reopening them does not immediately
  // re-trigger the auto-hide (the prior widths are what caused it).
  const onRequestClosePanels = props.onRequestClosePanels;
  const handleAutoHidePanels = onRequestClosePanels
    ? () => {
        cancelActiveResize();

        const main = mainRef.current;
        if (main) {
          const mainW = main.getBoundingClientRect().width;
          const panelW = panelRef.current?.getBoundingClientRect().width ?? 0;
          const gitPanelW = gitPanelRef.current?.getBoundingClientRect().width ?? 0;
          // Leave a small headroom past the hide threshold so resize jitter
          // doesn't immediately re-trigger.
          const targetMain = CONTENT_MIN_WIDTH + 24;
          const totalAvailable = mainW + panelW + gitPanelW;
          const allowanceForPanels = totalAvailable - targetMain;

          if (panelW > 0 && gitPanelW > 0) {
            const totalPanels = panelW + gitPanelW;
            if (allowanceForPanels < totalPanels) {
              const ratio = Math.max(0, allowanceForPanels) / totalPanels;
              updatePanelWidth(panelW * ratio);
              updateGitPanelWidth(gitPanelW * ratio);
            }
          } else if (panelW > 0) {
            if (allowanceForPanels < panelW) updatePanelWidth(allowanceForPanels);
          } else if (gitPanelW > 0) {
            if (allowanceForPanels < gitPanelW) updateGitPanelWidth(allowanceForPanels);
          }
        }

        onRequestClosePanels();
      }
    : undefined;

  useSidebarOverlayEffects({
    sidebarWidth,
    shellRef,
    mainRef,
    disabled: forceSidebarExpanded,
    ...(handleAutoHidePanels ? { onRequestClosePanels: handleAutoHidePanels } : {}),
  });

  const { rightPanelOpen, gitPanelOpen } = usePanelVisibility();
  const isBottom = terminalPosition === "bottom";
  const hasHeaders = sidebarHeader != null || contentHeader != null;
  const hasContentHeader = contentHeader != null;

  return (
    <div
      ref={shellRef}
      className="lightcode-shell flex h-full min-h-0 overflow-hidden bg-background text-foreground"
      style={hasHeaders ? { paddingTop: 0 } : undefined}
    >
      <MacCollapsedTracker shellRef={shellRef} forceSidebarExpanded={forceSidebarExpanded} />

      {!hasHeaders && <div aria-hidden="true" className="lightcode-drag-region" />}

      <ShellSidebarBackdrop forceSidebarExpanded={forceSidebarExpanded} />
      <ShellSidebarSpacer hasHeaders={hasHeaders} forceSidebarExpanded={forceSidebarExpanded} />

      <ShellSidebarAside
        sidebarRef={sidebarRef}
        sidebarHeader={sidebarHeader}
        sidebar={sidebar}
        hasHeaders={hasHeaders}
        isSidebarHandleHovered={isSidebarHandleHovered}
        forceSidebarExpanded={forceSidebarExpanded}
      />
      <SidebarWidthDriver
        sidebarRef={sidebarRef}
        sidebarWidth={sidebarWidth}
        forceSidebarExpanded={forceSidebarExpanded}
      />

      <ShellSidebarResizeHandle
        hasHeaders={hasHeaders}
        hasContentHeader={hasContentHeader}
        forceSidebarExpanded={forceSidebarExpanded}
        onMouseEnter={() => setIsSidebarHandleHovered(true)}
        onMouseLeave={() => setIsSidebarHandleHovered(false)}
        onMouseDown={(event) => {
          setIsSidebarHandleHovered(false);
          handleSidebarResizeStart(event);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [isolation:isolate]">
        {contentHeader && (
          <div
            className={`lightcode-overlay-header ${macosTrafficLightPadClass} flex shrink-0 items-center gap-3 bg-[var(--content-background)] px-2`}
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
            <main ref={mainRef} className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
              {isMac() && !contentHeader && (
                <div aria-hidden="true" className="lightcode-content-drag-region" />
              )}
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
  );
}
