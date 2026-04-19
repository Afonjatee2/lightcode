import type { MouseEvent, ReactNode, RefObject } from "react";
import { usePanelVisibility } from "./usePanelVisibility";

export function GitAsideSlot(props: {
  gitPanel: ReactNode;
  gitPanelWidth: number;
  isResizing: boolean;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  panelInnerRef: RefObject<HTMLDivElement | null>;
}) {
  const { gitPanel, gitPanelWidth, isResizing, onResizeStart, panelRef, panelInnerRef } = props;
  const { gitPanelOpen } = usePanelVisibility();

  const gitPanelDisplayWidth = gitPanelOpen ? gitPanelWidth : 0;

  return (
    <>
      {gitPanelOpen && (
        <div
          className="lightcode-resize-handle mb-2"
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize git panel"
        />
      )}
      <aside
        ref={panelRef}
        className={`relative mb-2 min-h-0 overflow-hidden ${
          gitPanelDisplayWidth > 0 ? "border-l border-[color:var(--border)]" : ""
        } ${!isResizing ? "transition-[width,min-width] duration-200" : ""}`}
        style={{ width: gitPanelDisplayWidth, minWidth: gitPanelDisplayWidth }}
      >
        <div
          ref={panelInnerRef}
          className={`h-full transition-[transform,opacity] duration-200 ${
            gitPanelOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
          }`}
          style={{ width: gitPanelWidth }}
        >
          {gitPanel}
        </div>
      </aside>
    </>
  );
}
