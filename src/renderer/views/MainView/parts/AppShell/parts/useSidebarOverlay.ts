import { type RefObject, useEffect, useRef } from "react";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { selectShouldOverlay, useSidebarOverlayStore } from "@/renderer/state/sidebarOverlayStore";
import { CONTENT_MIN_WIDTH } from "./useResizablePanels";

const SIDEBAR_COLLAPSED_WIDTH = 48;

export { SIDEBAR_COLLAPSED_WIDTH };

function readStableObservedWidth(entry: ResizeObserverEntry): number | null {
  if (!entry.target.isConnected) return null;
  const width = entry.contentRect.width;
  if (width <= 0) return null;
  return width;
}

function readAnyPanelOpen(): boolean {
  const dev = useDevTerminalStore.getState();
  const panel = usePanelStore.getState();
  const gitPanelOpen = !!panel.gitReviewContext && panel.gitReviewAsPanel;
  const filesPanelOpen = panel.filesPanelContext !== null;
  return dev.isOpen || gitPanelOpen || filesPanelOpen;
}

/**
 * Wires DOM ResizeObservers and the overlay-ready raf chain to the
 * `sidebarOverlayStore`. Sidebar overlay state lives in zustand so that the
 * components that *render* the sidebar can subscribe to specific slices
 * (and only those subscribers re-render on collapse). This hook owns the
 * effects and writes to the store; it returns nothing.
 */
export function useSidebarOverlayEffects(opts: {
  sidebarWidth: number;
  shellRef: RefObject<HTMLDivElement | null>;
  mainRef: RefObject<HTMLElement | null>;
  onRequestClosePanels?: (() => void) | undefined;
}) {
  const { sidebarWidth, shellRef, mainRef, onRequestClosePanels } = opts;
  const didAutoHideRef = useRef<"panels" | "sidebar" | null>(null);
  const onRequestClosePanelsRef = useRef(onRequestClosePanels);
  onRequestClosePanelsRef.current = onRequestClosePanels;

  // Shell width → isNarrow (drives the overlay flag).
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = readStableObservedWidth(entry);
      if (width === null) return;
      const next = width < CONTENT_MIN_WIDTH + sidebarWidth;
      useSidebarOverlayStore.getState().setNarrow(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sidebarWidth, shellRef]);

  // Main width → auto-hide panels first, then sidebar, when content is squeezed.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = readStableObservedWidth(entry);
      if (width === null) return;
      const s = useSidebarOverlayStore.getState();
      if (width < CONTENT_MIN_WIDTH) {
        if (didAutoHideRef.current) return;
        if (readAnyPanelOpen()) {
          didAutoHideRef.current = "panels";
          onRequestClosePanelsRef.current?.();
        } else if (!s.isCollapsed && !s.isNarrow) {
          didAutoHideRef.current = "sidebar";
          s.setCollapsed(true);
        }
      } else {
        didAutoHideRef.current = null;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mainRef]);

  // shouldOverlay → overlayReady, with two rafs of delay (matches the
  // original behaviour: the overlay element mounts at translateX(-full),
  // then we flip overlayReady to slide it in). Two-phase so the browser
  // commits the off-screen position before the transition starts.
  useEffect(() => {
    let pendingFrame1: number | null = null;
    let pendingFrame2: number | null = null;

    const apply = (shouldOverlay: boolean) => {
      if (pendingFrame1 !== null) cancelAnimationFrame(pendingFrame1);
      if (pendingFrame2 !== null) cancelAnimationFrame(pendingFrame2);
      pendingFrame1 = null;
      pendingFrame2 = null;

      if (!shouldOverlay) {
        useSidebarOverlayStore.getState().setOverlayReady(false);
        return;
      }
      pendingFrame1 = requestAnimationFrame(() => {
        pendingFrame1 = null;
        pendingFrame2 = requestAnimationFrame(() => {
          pendingFrame2 = null;
          useSidebarOverlayStore.getState().setOverlayReady(true);
        });
      });
    };

    apply(selectShouldOverlay(useSidebarOverlayStore.getState()));

    const unsub = useSidebarOverlayStore.subscribe((state, prevState) => {
      const cur = selectShouldOverlay(state);
      if (cur !== selectShouldOverlay(prevState)) apply(cur);
    });

    return () => {
      if (pendingFrame1 !== null) cancelAnimationFrame(pendingFrame1);
      if (pendingFrame2 !== null) cancelAnimationFrame(pendingFrame2);
      unsub();
    };
  }, []);
}
