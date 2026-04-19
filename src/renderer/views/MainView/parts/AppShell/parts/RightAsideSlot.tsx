import type { MouseEvent, ReactNode, RefObject } from "react";
import { usePanelVisibility } from "./usePanelVisibility";

export function RightAsideSlot(props: {
  rightPanel: ReactNode;
  isBottom: boolean;
  panelWidth: number;
  panelHeight: number;
  isResizing: boolean;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onResizeBottomStart: (event: MouseEvent<HTMLDivElement>) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  panelInnerRef: RefObject<HTMLDivElement | null>;
}) {
  const {
    rightPanel,
    isBottom,
    panelWidth,
    panelHeight,
    isResizing,
    onResizeStart,
    onResizeBottomStart,
    panelRef,
    panelInnerRef,
  } = props;
  const { rightPanelOpen } = usePanelVisibility();

  const panelDisplayWidth = rightPanelOpen ? panelWidth : 0;
  const panelDisplayHeight = rightPanelOpen ? panelHeight : 0;

  return (
    <>
      {rightPanelOpen &&
        (isBottom ? (
          <div
            className="lightcode-resize-handle-horizontal"
            onMouseDown={onResizeBottomStart}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize terminal panel"
          />
        ) : (
          <div
            className="lightcode-resize-handle mb-2"
            onMouseDown={onResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize terminal panel"
          />
        ))}
      <aside
        ref={panelRef}
        className={`relative overflow-hidden ${
          isBottom
            ? `min-w-0 border-t border-[color:var(--border)] ${!isResizing ? "transition-[height,min-height,opacity] duration-200" : ""}`
            : `mb-2 min-h-0 border-l border-[color:var(--border)] ${!isResizing ? "transition-[width,min-width,opacity] duration-200" : ""}`
        } ${rightPanelOpen ? "opacity-100" : "opacity-0"}`}
        style={
          isBottom
            ? { height: panelDisplayHeight, minHeight: panelDisplayHeight }
            : { width: panelDisplayWidth, minWidth: panelDisplayWidth }
        }
      >
        <div
          ref={panelInnerRef}
          className={isBottom ? "h-full w-full" : "h-full"}
          style={isBottom ? { height: panelHeight } : { width: panelWidth }}
        >
          {rightPanel}
        </div>
      </aside>
    </>
  );
}
