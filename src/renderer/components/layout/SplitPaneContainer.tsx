import React, { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/react";
import { leadPaneId, type PaneLayout, type PaneLayoutAxis } from "@/shared/paneLayout";
import { useIsInsertSplitHighlighted, useIsRootInsertHighlighted } from "@/renderer/dnd";

const MIN_PANE_PERCENT = 15;
const ROOT_INSERT_ZONE_SIZE = 12;
const ROOT_INSERT_ZONE_INSET = ROOT_INSERT_ZONE_SIZE / 2;

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

function SplitDivider(props: {
  path: number[];
  axis: PaneLayoutAxis;
  index: number;
  onPointerDown: (event: React.MouseEvent) => void;
}) {
  const zoneId = `split-divider:${props.axis}:${props.path.join("-")}:${props.index}`;
  const elementRef = useRef<HTMLDivElement>(null);
  useDroppable({
    id: `pane-insert:${props.axis}:${props.path.join("-")}:${props.index}`,
    accept: ["pane", "thread", "new-thread"],
    data: {
      type: "pane-insert-zone",
      path: props.path,
      axis: props.axis,
      index: props.index,
      zoneId,
    },
    element: elementRef,
  });
  const isHighlighted = useIsInsertSplitHighlighted(zoneId);

  return (
    <div
      ref={elementRef}
      className={`${
        props.axis === "vertical" ? "lightcode-pane-divider" : "lightcode-pane-divider-horizontal"
      } ${isHighlighted ? "is-highlighted" : ""}`}
      onMouseDown={props.onPointerDown}
      role="separator"
      aria-orientation={props.axis === "vertical" ? "vertical" : "horizontal"}
      aria-label={props.axis === "vertical" ? "Resize column" : "Resize row"}
    />
  );
}

function RootInsertZone(props: {
  axis: PaneLayoutAxis;
  index: number;
  side: "top" | "right" | "bottom" | "left";
}) {
  const zoneId = `root-insert:${props.side}`;
  const elementRef = useRef<HTMLDivElement>(null);
  useDroppable({
    id: `pane-root-insert:${props.side}`,
    accept: ["pane", "thread", "new-thread"],
    data: {
      type: "pane-insert-zone",
      path: [],
      axis: props.axis,
      index: props.index,
      zoneId,
    },
    element: elementRef,
  });
  const isHighlighted = useIsRootInsertHighlighted(zoneId);

  const edgeClass =
    props.side === "top"
      ? "top-0 right-0 left-0 cursor-row-resize"
      : props.side === "bottom"
        ? "right-0 bottom-0 left-0 cursor-row-resize"
        : props.side === "left"
          ? "top-0 bottom-0 left-0 cursor-col-resize"
          : "top-0 right-0 bottom-0 cursor-col-resize";

  const edgeStyle =
    props.side === "top" || props.side === "bottom"
      ? { height: `${ROOT_INSERT_ZONE_INSET}px` }
      : { width: `${ROOT_INSERT_ZONE_INSET}px` };

  const lineClass =
    props.side === "top"
      ? "top-0 right-0 left-0 h-0.5"
      : props.side === "bottom"
        ? "right-0 bottom-0 left-0 h-0.5"
        : props.side === "left"
          ? "top-0 bottom-0 left-0 w-0.5"
          : "top-0 right-0 bottom-0 w-0.5";

  return (
    <div ref={elementRef} className={`absolute z-10 ${edgeClass}`} style={edgeStyle}>
      {isHighlighted ? (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-full bg-accent ${lineClass}`}
        />
      ) : null}
    </div>
  );
}

function SplitGroup(props: {
  layout: PaneLayout;
  path: number[];
  renderPane: (paneId: string) => React.ReactNode;
}) {
  const children = props.layout.kind === "split" ? props.layout.children : [props.layout];
  const axis = props.layout.kind === "split" ? props.layout.axis : "vertical";
  const count = children.length;
  const [sizes, setSizes] = useState(() => equalSizes(count));
  const [resizingIndex, setResizingIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ start: 0, beforeStart: 0, afterStart: 0, index: 0 });
  const prevKey = useRef(`${axis}:${count}`);

  const layoutKey = `${axis}:${count}`;
  let activeSizes = sizes;
  if (prevKey.current !== layoutKey) {
    activeSizes = equalSizes(count);
    prevKey.current = layoutKey;
  }

  useEffect(() => {
    setSizes((prev) => (prev.length !== count ? equalSizes(count) : prev));
  }, [count]);

  useEffect(() => {
    if (resizingIndex === null) return;

    function onMouseMove(event: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const isVertical = axis === "vertical";
      const deltaPx = (isVertical ? event.clientX : event.clientY) - dragRef.current.start;
      const containerSize = isVertical ? container.offsetWidth : container.offsetHeight;
      const deltaPercent = (deltaPx / containerSize) * 100;
      const newBefore = dragRef.current.beforeStart + deltaPercent;
      const newAfter = dragRef.current.afterStart - deltaPercent;
      if (newBefore < MIN_PANE_PERCENT || newAfter < MIN_PANE_PERCENT) return;
      setSizes((prev) => {
        const next = [...prev];
        next[dragRef.current.index] = newBefore;
        next[dragRef.current.index + 1] = newAfter;
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
  }, [axis, resizingIndex]);

  function handleResizeStart(event: React.MouseEvent, index: number) {
    event.preventDefault();
    dragRef.current = {
      start: axis === "vertical" ? event.clientX : event.clientY,
      beforeStart: activeSizes[index]!,
      afterStart: activeSizes[index + 1]!,
      index,
    };
    setResizingIndex(index);
  }

  return (
    <div
      ref={containerRef}
      className={`flex h-full min-h-0 w-full ${
        axis === "vertical" ? "flex-row" : "flex-col"
      } ${resizingIndex !== null ? "select-none" : ""}`}
    >
      {children.map((child, index) => (
        <React.Fragment key={leadPaneId(child)}>
          <div
            className="min-h-0 min-w-0 overflow-hidden"
            style={{
              flexBasis: `${activeSizes[index] ?? 100 / count}%`,
              flexGrow: 0,
              flexShrink: 1,
            }}
          >
            <PaneLayoutNode
              layout={child}
              path={[...props.path, index]}
              renderPane={props.renderPane}
            />
          </div>
          {index < children.length - 1 ? (
            <SplitDivider
              path={props.path}
              axis={axis}
              index={index + 1}
              onPointerDown={(event) => handleResizeStart(event, index)}
            />
          ) : null}
        </React.Fragment>
      ))}
      {resizingIndex !== null ? (
        <div
          className={`fixed inset-0 z-50 ${
            axis === "vertical" ? "cursor-col-resize" : "cursor-row-resize"
          }`}
        />
      ) : null}
    </div>
  );
}

function PaneLayoutNode(props: {
  layout: PaneLayout;
  path: number[];
  renderPane: (paneId: string) => React.ReactNode;
}) {
  if (props.layout.kind === "leaf") {
    return <>{props.renderPane(props.layout.paneId)}</>;
  }

  return <SplitGroup layout={props.layout} path={props.path} renderPane={props.renderPane} />;
}

function RootPaneLayout(props: {
  layout: PaneLayout;
  renderPane: (paneId: string) => React.ReactNode;
}) {
  return <SplitGroup layout={props.layout} path={[]} renderPane={props.renderPane} />;
}

export function SplitPaneContainer(props: {
  layout: PaneLayout;
  renderPane: (paneId: string) => React.ReactNode;
}) {
  const rightIndex =
    props.layout.kind === "split" && props.layout.axis === "vertical"
      ? props.layout.children.length
      : 1;
  const bottomIndex =
    props.layout.kind === "split" && props.layout.axis === "horizontal"
      ? props.layout.children.length
      : 1;

  return (
    <div className="relative h-full min-h-0 w-full">
      <RootInsertZone axis="horizontal" index={0} side="top" />
      <RootInsertZone axis="horizontal" index={bottomIndex} side="bottom" />
      <RootInsertZone axis="vertical" index={0} side="left" />
      <RootInsertZone axis="vertical" index={rightIndex} side="right" />
      <div
        className="h-full min-h-0 w-full"
        style={{
          paddingTop: ROOT_INSERT_ZONE_INSET,
          paddingRight: ROOT_INSERT_ZONE_INSET,
          paddingBottom: ROOT_INSERT_ZONE_INSET,
          paddingLeft: ROOT_INSERT_ZONE_INSET,
        }}
      >
        <RootPaneLayout layout={props.layout} renderPane={props.renderPane} />
      </div>
    </div>
  );
}
