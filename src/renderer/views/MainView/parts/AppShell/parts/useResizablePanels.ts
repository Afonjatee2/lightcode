import type React from "react";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredNumber } from "@/renderer/utils/localStorage";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_DEFAULT_WIDTH = 350;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 700;
const PANEL_DEFAULT_WIDTH = 480;
const PANEL_BOTTOM_MIN_HEIGHT = 200;
const PANEL_BOTTOM_MAX_HEIGHT = 500;
const PANEL_BOTTOM_DEFAULT_HEIGHT = 300;
const GIT_PANEL_MIN_WIDTH = 280;
const GIT_PANEL_MAX_WIDTH = 500;
const GIT_PANEL_DEFAULT_WIDTH = 350;

export const CONTENT_MIN_WIDTH = 540;

export type ResizeTarget = "sidebar" | "panel" | "panel-bottom" | "git-panel" | null;

export function useResizablePanels(refs: {
  sidebarRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  panelInnerRef: RefObject<HTMLDivElement | null>;
  gitPanelRef: RefObject<HTMLDivElement | null>;
  gitPanelInnerRef: RefObject<HTMLDivElement | null>;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredNumber("lightcode-sidebar-width", SIDEBAR_DEFAULT_WIDTH),
  );
  const [panelWidth, setPanelWidth] = useState(() =>
    readStoredNumber("lightcode-panel-width", PANEL_DEFAULT_WIDTH),
  );
  const [panelHeight, setPanelHeight] = useState(() =>
    readStoredNumber("lightcode-panel-height", PANEL_BOTTOM_DEFAULT_HEIGHT),
  );
  const [gitPanelWidth, setGitPanelWidth] = useState(() =>
    readStoredNumber("lightcode-git-panel-width", GIT_PANEL_DEFAULT_WIDTH),
  );
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget>(null);
  const resizeRef = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 });
  const sizeRef = useRef({
    sidebarWidth,
    panelWidth,
    panelHeight,
    gitPanelWidth,
  });

  useEffect(() => {
    sizeRef.current = {
      sidebarWidth,
      panelWidth,
      panelHeight,
      gitPanelWidth,
    };
  }, [gitPanelWidth, panelHeight, panelWidth, sidebarWidth]);

  const applySidebarWidth = useCallback(
    (next: number) => {
      const sidebar = refs.sidebarRef.current;
      if (!sidebar) return;
      sidebar.style.width = `${next}px`;
      sidebar.style.minWidth = `${next}px`;
    },
    [refs.sidebarRef],
  );

  const applyPanelWidth = useCallback(
    (next: number) => {
      const panel = refs.panelRef.current;
      if (panel) {
        panel.style.width = `${next}px`;
        panel.style.minWidth = `${next}px`;
      }
      const inner = refs.panelInnerRef.current;
      if (inner) {
        inner.style.width = `${next}px`;
      }
    },
    [refs.panelInnerRef, refs.panelRef],
  );

  const applyPanelHeight = useCallback(
    (next: number) => {
      const panel = refs.panelRef.current;
      if (panel) {
        panel.style.height = `${next}px`;
        panel.style.minHeight = `${next}px`;
      }
      const inner = refs.panelInnerRef.current;
      if (inner) {
        inner.style.height = `${next}px`;
      }
    },
    [refs.panelInnerRef, refs.panelRef],
  );

  const applyGitPanelWidth = useCallback(
    (next: number) => {
      const panel = refs.gitPanelRef.current;
      if (panel) {
        panel.style.width = `${next}px`;
        panel.style.minWidth = `${next}px`;
      }
      const inner = refs.gitPanelInnerRef.current;
      if (inner) {
        inner.style.width = `${next}px`;
      }
    },
    [refs.gitPanelInnerRef, refs.gitPanelRef],
  );

  useEffect(() => {
    localStorage.setItem("lightcode-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("lightcode-panel-width", String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    localStorage.setItem("lightcode-panel-height", String(panelHeight));
  }, [panelHeight]);

  useEffect(() => {
    localStorage.setItem("lightcode-git-panel-width", String(gitPanelWidth));
  }, [gitPanelWidth]);

  useEffect(() => {
    if (!resizeTarget) return;

    function onMouseMove(e: MouseEvent) {
      if (resizeTarget === "sidebar") {
        const delta = e.clientX - resizeRef.current.startX;
        const next = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, resizeRef.current.startWidth + delta),
        );
        sizeRef.current.sidebarWidth = next;
        applySidebarWidth(next);
      } else if (resizeTarget === "panel") {
        const delta = resizeRef.current.startX - e.clientX;
        const next = Math.min(
          PANEL_MAX_WIDTH,
          Math.max(PANEL_MIN_WIDTH, resizeRef.current.startWidth + delta),
        );
        sizeRef.current.panelWidth = next;
        applyPanelWidth(next);
      } else if (resizeTarget === "panel-bottom") {
        const delta = resizeRef.current.startY - e.clientY;
        const next = Math.min(
          PANEL_BOTTOM_MAX_HEIGHT,
          Math.max(PANEL_BOTTOM_MIN_HEIGHT, resizeRef.current.startHeight + delta),
        );
        sizeRef.current.panelHeight = next;
        applyPanelHeight(next);
      } else if (resizeTarget === "git-panel") {
        const delta = resizeRef.current.startX - e.clientX;
        const next = Math.min(
          GIT_PANEL_MAX_WIDTH,
          Math.max(GIT_PANEL_MIN_WIDTH, resizeRef.current.startWidth + delta),
        );
        sizeRef.current.gitPanelWidth = next;
        applyGitPanelWidth(next);
      }
    }

    function onMouseUp() {
      setSidebarWidth(sizeRef.current.sidebarWidth);
      setPanelWidth(sizeRef.current.panelWidth);
      setPanelHeight(sizeRef.current.panelHeight);
      setGitPanelWidth(sizeRef.current.gitPanelWidth);
      setResizeTarget(null);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [applyGitPanelWidth, applyPanelHeight, applyPanelWidth, applySidebarWidth, resizeTarget]);

  function handleSidebarResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startY: 0, startWidth: sidebarWidth, startHeight: 0 };
    setResizeTarget("sidebar");
  }

  function handlePanelResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startY: 0, startWidth: panelWidth, startHeight: 0 };
    setResizeTarget("panel");
  }

  function handlePanelBottomResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = { startX: 0, startY: e.clientY, startWidth: 0, startHeight: panelHeight };
    setResizeTarget("panel-bottom");
  }

  function handleGitPanelResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startY: 0, startWidth: gitPanelWidth, startHeight: 0 };
    setResizeTarget("git-panel");
  }

  return {
    sidebarWidth,
    panelWidth,
    panelHeight,
    gitPanelWidth,
    resizeTarget,
    handleSidebarResizeStart,
    handlePanelResizeStart,
    handlePanelBottomResizeStart,
    handleGitPanelResizeStart,
  };
}
