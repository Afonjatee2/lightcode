import { useEffect, useState } from "react";
import { useFileEditorStore } from "../../state/fileEditorStore";
import { FileEditorPane } from "./FileEditorPane";

/**
 * Inline panel overlay that covers the main content area (no modal, no backdrop).
 * Files are selected from the right sidebar's file tree.
 */
export function FileEditorPanel() {
  const rootContext = useFileEditorStore((state) => state.rootContext);
  const overlayMode = useFileEditorStore((state) => state.overlayMode);
  const setOverlayMode = useFileEditorStore((state) => state.setOverlayMode);

  const isOpen = rootContext !== null && overlayMode === "modal";

  // Fade-in animation
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (isOpen) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!isOpen) return null;

  function requestClose() {
    const hasDirty = Object.values(useFileEditorStore.getState().buffers).some(
      (buffer) => buffer.status === "ready" && buffer.isDirty,
    );
    if (hasDirty && !window.confirm("Discard unsaved editor changes?")) {
      return;
    }
    setOverlayMode(null);
  }

  return (
    <div
      className={`absolute inset-0 z-20 flex flex-col bg-[var(--content-background)] transition-opacity duration-100 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <FileEditorPane showTabs onClose={requestClose} />
    </div>
  );
}
