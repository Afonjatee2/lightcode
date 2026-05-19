import { useEffect, useRef, useState, type ReactNode } from "react";

export type OverlayShellMode = "fixed" | "absolute";

/**
 * Shared overlay wrapper with fade-in/fade-out animation.
 * Renders children in a full-cover container and animates opacity on
 * mount/unmount. Pressing Escape triggers a close via the fade-out → onExited
 * path.
 *
 * `mode="fixed"` (default) covers the whole window. `mode="absolute"` covers
 * the nearest positioned ancestor — used for pane-scoped overlays (e.g. the
 * sub-agent drawer over a single chat pane in a split-pane layout).
 */
export function OverlayShell(props: {
  open: boolean;
  onExited?: () => void;
  children: ReactNode;
  mode?: OverlayShellMode;
}) {
  const { open, onExited, children, mode = "fixed" } = props;
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const escapeClosingRef = useRef(false);

  // Mount immediately when opened, fade in on next frame
  useEffect(() => {
    if (open) {
      if (escapeClosingRef.current) return;
      setMounted(true);
      // Delay to allow the DOM to render at opacity-0 before transitioning
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    // Parent acknowledged close — reset escape flag
    escapeClosingRef.current = false;
    // Start fade-out
    setVisible(false);
  }, [open]);

  // Close on Escape key — triggers fade-out, then onExited resets parent state
  useEffect(() => {
    if (!open || !onExited) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        escapeClosingRef.current = true;
        setVisible(false);
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, onExited]);

  // Unmount after fade-out transition completes
  function handleTransitionEnd() {
    if (!visible) {
      setMounted(false);
      onExited?.();
    }
  }

  if (!mounted) return null;

  const positionClass = mode === "fixed" ? "fixed inset-0 z-50" : "absolute inset-0 z-30";
  return (
    <div
      data-overlay-surface=""
      className={`${positionClass} flex flex-col bg-background transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onTransitionEnd={handleTransitionEnd}
    >
      {children}
    </div>
  );
}
