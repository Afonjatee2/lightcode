import { type RefObject, useEffect, useRef, useState } from "react";
import { readStoredBoolean } from "@/renderer/utils/localStorage";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { CONTENT_MIN_WIDTH } from "./useResizablePanels";

const SIDEBAR_COLLAPSED_WIDTH = 48;

export { SIDEBAR_COLLAPSED_WIDTH };

function readAnyPanelOpen(): boolean {
  const dev = useDevTerminalStore.getState();
  const panel = usePanelStore.getState();
  const gitPanelOpen = !!panel.gitReviewContext && panel.gitReviewAsPanel;
  const filesPanelOpen = panel.filesPanelContext !== null;
  return dev.isOpen || gitPanelOpen || filesPanelOpen;
}

export function useSidebarOverlay(opts: {
  sidebarWidth: number;
  shellRef: RefObject<HTMLDivElement | null>;
  mainRef: RefObject<HTMLElement | null>;
  onRequestClosePanels?: (() => void) | undefined;
}) {
  const { sidebarWidth, shellRef, mainRef, onRequestClosePanels } = opts;

  const [isCollapsed, setIsCollapsed] = useState(() =>
    readStoredBoolean("lightcode-sidebar-collapsed", false),
  );
  const [isNarrow, setIsNarrow] = useState(false);
  const [closingOverlay, setClosingOverlay] = useState(false);
  const [overlayReady, setOverlayReady] = useState(false);
  const didAutoHideRef = useRef<"panels" | "sidebar" | null>(null);
  const skipTransitionRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("lightcode-sidebar-collapsed", String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setIsNarrow(entry.contentRect.width < CONTENT_MIN_WIDTH + sidebarWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sidebarWidth, shellRef]);

  const latestRef = useRef({ isCollapsed, isNarrow });
  latestRef.current = { isCollapsed, isNarrow };
  const onRequestClosePanelsRef = useRef(onRequestClosePanels);
  onRequestClosePanelsRef.current = onRequestClosePanels;

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const latest = latestRef.current;
      if (width < CONTENT_MIN_WIDTH) {
        if (didAutoHideRef.current) return;
        if (readAnyPanelOpen()) {
          didAutoHideRef.current = "panels";
          onRequestClosePanelsRef.current?.();
        } else if (!latest.isCollapsed && !latest.isNarrow) {
          didAutoHideRef.current = "sidebar";
          setIsCollapsed(true);
        }
      } else {
        didAutoHideRef.current = null;
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [mainRef]);

  const shouldOverlay = !isCollapsed && isNarrow;
  const isOverlay = shouldOverlay || closingOverlay;

  useEffect(() => {
    if (!shouldOverlay) {
      setOverlayReady(false);
      return;
    }
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        setOverlayReady(true);
      });
    });
    return () => {
      cancelled = true;
      setOverlayReady(false);
    };
  }, [shouldOverlay]);

  const collapse = () => {
    if (shouldOverlay) {
      setClosingOverlay(true);
      setTimeout(() => {
        skipTransitionRef.current = true;
        setClosingOverlay(false);
        setIsCollapsed(true);
        requestAnimationFrame(() => {
          skipTransitionRef.current = false;
        });
      }, 200);
    } else {
      setIsCollapsed(true);
    }
  };
  const expand = () => setIsCollapsed(false);

  return {
    isCollapsed,
    isOverlay,
    closingOverlay,
    overlayReady,
    skipTransitionRef,
    collapse,
    expand,
  };
}
