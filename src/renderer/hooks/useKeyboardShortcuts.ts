import { useEffect } from "react";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { usePanelStore } from "@/renderer/state/panelStore";

export function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        useDevTerminalStore.getState().togglePanel();
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        usePanelStore.getState().openThreadSearch();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        if (useFileEditorStore.getState().activePath) return;

        const state = useAppStore.getState();
        if (state.view.kind === "thread") {
          e.preventDefault();
          const { panes } = state.view;
          const target =
            state.focusedPaneId && panes.includes(state.focusedPaneId)
              ? state.focusedPaneId
              : panes.at(-1)!;
          state.closePane(target);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
