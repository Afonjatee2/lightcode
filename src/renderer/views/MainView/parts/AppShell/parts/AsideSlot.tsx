import type { MouseEvent, ReactNode, RefObject } from "react";

export type AsideOrientation = "vertical" | "horizontal";

export function AsideSlot(props: {
  children: ReactNode;
  orientation: AsideOrientation;
  isOpen: boolean;
  targetWidth?: number;
  targetHeight?: number;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  panelInnerRef: RefObject<HTMLDivElement | null>;
  ariaLabel: string;
}) {
  const {
    children,
    orientation,
    isOpen,
    targetWidth,
    targetHeight,
    onResizeStart,
    panelRef,
    panelInnerRef,
    ariaLabel,
  } = props;

  const isHorizontal = orientation === "horizontal";
  const displayWidth = !isHorizontal ? (isOpen ? targetWidth : 0) : undefined;
  const displayHeight = isHorizontal ? (isOpen ? targetHeight : 0) : undefined;

  // Timings:
  // Show: Faster fade in (300ms), fast width/height (150ms)
  // Hide: Fast width/height (150ms), fast-ish fade out (200ms)
  // During an active drag, useResizablePanels writes transitionDuration: 0ms directly
  // to the panel element so per-frame width/height updates aren't smoothed.
  const duration = isOpen ? "300ms" : "200ms";
  const sizeDuration = "150ms";

  return (
    <>
      {isOpen && (
        <div
          key="handle"
          className={
            isHorizontal ? "lightcode-resize-handle-horizontal" : "lightcode-resize-handle"
          }
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation={orientation}
          aria-label={ariaLabel}
        />
      )}
      <aside
        key="aside"
        ref={panelRef}
        className={`relative overflow-hidden bg-[var(--content-background)] ${
          isHorizontal
            ? "min-w-0 border-t border-[color:var(--border)]"
            : "min-h-0 border-l border-[color:var(--border)]"
        }`}
        style={{
          ...(isHorizontal
            ? { height: displayHeight, minHeight: displayHeight }
            : { width: displayWidth, minWidth: displayWidth }),
          opacity: isOpen ? 1 : 0,
          transitionProperty: "width, min-width, height, min-height, opacity, border-color",
          transitionDuration: `${sizeDuration}, ${sizeDuration}, ${sizeDuration}, ${sizeDuration}, ${duration}, 200ms`,
          transitionTimingFunction: isOpen ? "ease-out" : "ease-in",
          willChange: "width, min-width, height, min-height, opacity",
        }}
      >
        <div
          ref={panelInnerRef}
          className="h-full w-full"
          style={isHorizontal ? { height: targetHeight } : { width: targetWidth }}
        >
          {children}
        </div>
      </aside>
    </>
  );
}
