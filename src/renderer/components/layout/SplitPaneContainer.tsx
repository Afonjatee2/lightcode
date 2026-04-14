import React, { Children, type ReactNode, useEffect, useRef, useState } from "react";
import { useDndContext } from "../../dnd";

const MIN_PANE_PERCENT = 15;

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

export function SplitPaneContainer(props: { children: ReactNode }) {
  const items = Children.toArray(props.children).filter(Boolean);
  const count = items.length;
  const [sizes, setSizes] = useState(() => equalSizes(count));
  const [resizingIndex, setResizingIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startX: 0, leftStart: 0, rightStart: 0, index: 0 });

  const childKeys = items
    .map((child) =>
      typeof child === "object" && child !== null && "key" in child
        ? (child as React.ReactElement).key
        : null,
    )
    .join(",");

  // Track previous count+keys to detect changes synchronously (no useEffect lag)
  const prevRef = useRef({ count, childKeys });

  // Compute sizes synchronously: if count or keys changed, reset to equal sizes
  // immediately so the first render already has correct flex-basis values.
  let activeSizes = sizes;
  if (prevRef.current.count !== count || prevRef.current.childKeys !== childKeys) {
    activeSizes = equalSizes(count);
    prevRef.current = { count, childKeys };
  }

  // Sync React state to match (fires after paint, but layout is already correct)
  useEffect(() => {
    setSizes((prev) => {
      if (prev.length !== count) return equalSizes(count);
      return prev;
    });
  }, [count, childKeys]);

  useEffect(() => {
    if (resizingIndex === null) return;

    function onMouseMove(e: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const totalWidth = container.offsetWidth;
      const deltaPx = e.clientX - dragRef.current.startX;
      const deltaPercent = (deltaPx / totalWidth) * 100;

      const newLeft = dragRef.current.leftStart + deltaPercent;
      const newRight = dragRef.current.rightStart - deltaPercent;

      if (newLeft < MIN_PANE_PERCENT || newRight < MIN_PANE_PERCENT) return;

      setSizes((prev) => {
        const next = [...prev];
        next[dragRef.current.index] = newLeft;
        next[dragRef.current.index + 1] = newRight;
        return next;
      });
    }

    function onMouseUp() {
      setResizingIndex(null);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizingIndex]);

  function handleResizeStart(e: React.MouseEvent, index: number) {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      leftStart: activeSizes[index]!,
      rightStart: activeSizes[index + 1]!,
      index,
    };
    setResizingIndex(index);
  }

  const { paneIndicator } = useDndContext();

  return (
    <div
      ref={containerRef}
      className={`flex h-full min-h-0 w-full ${resizingIndex !== null ? "select-none" : ""}`}
    >
      {items.map((child, i) => (
        <React.Fragment
          key={
            typeof child === "object" && child !== null && "key" in child
              ? (child as React.ReactElement).key
              : i
          }
        >
          <div
            className="h-full min-h-0 min-w-0 overflow-hidden"
            style={{ flexBasis: `${activeSizes[i] ?? 100 / count}%`, flexGrow: 0, flexShrink: 1 }}
          >
            {child}
          </div>
          {i < count - 1 && (
            <div
              className={`lightcode-pane-divider ${paneIndicator?.kind === "insert" && paneIndicator.index === i + 1 ? "is-highlighted" : ""}`}
              onMouseDown={(e) => handleResizeStart(e, i)}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize pane"
            />
          )}
        </React.Fragment>
      ))}
      {resizingIndex !== null && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  );
}
