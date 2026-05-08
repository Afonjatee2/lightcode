import { useEffect, useRef } from "react";
import { Tooltip } from "@heroui/react";
import { ArrowRightLeft, Check, ChevronDown, Hourglass, ListChecks } from "lucide-react";
import type { ThreadTodoDockPlacement } from "@/renderer/state/threadTodoDockStore";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import type { ThreadTodoDockState, ThreadTodoStepStatus } from "./threadTodoState";

interface ThreadTodoDockProps {
  state: ThreadTodoDockState;
  placement: ThreadTodoDockPlacement;
  collapsed: boolean;
  onPlacementChange: (placement: ThreadTodoDockPlacement) => void;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function ThreadTodoDock(props: ThreadTodoDockProps) {
  const { state, placement, collapsed, onPlacementChange, onCollapsedChange } = props;
  const activeStep = state.steps[state.activeIndex] ?? state.steps[0];
  const activeRowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (collapsed) return;
    if (typeof activeRowRef.current?.scrollIntoView === "function") {
      activeRowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [collapsed, state.activeIndex, state.sourceItemId, state.steps.length]);

  if (!activeStep) return null;

  const displayedSteps = collapsed ? [activeStep] : state.steps;
  const moveLabel =
    placement === "composer" ? "Move todo dock to right panel" : "Attach todo dock to composer";
  const countLabel = `${state.steps.length} ${state.steps.length === 1 ? "task" : "tasks"}`;

  return (
    <section
      aria-label="Thread todo dock"
      className={
        placement === "composer"
          ? "flex flex-col border-b border-[color:var(--border)] bg-transparent text-xs"
          : collapsed
            ? "flex flex-col rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)] text-xs"
            : "flex h-full min-h-0 flex-col rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)] text-xs"
      }
      data-collapsed={collapsed ? "true" : "false"}
      data-placement={placement}
    >
      <div className="flex items-center gap-2 px-2 py-1 leading-none">
        <ListChecks className="size-3.5 shrink-0 text-foreground-muted" />
        <div className="flex min-w-0 flex-1 items-center gap-2 leading-none">
          <span className="font-semibold text-foreground">Plan</span>
          <span className="text-[0.85em] text-[color:var(--muted)]">{countLabel}</span>
        </div>
        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <button
              aria-label={moveLabel}
              className="shrink-0 rounded p-1 text-muted/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              type="button"
              onClick={() => onPlacementChange(placement === "composer" ? "right" : "composer")}
            >
              <ArrowRightLeft className="size-3.5" />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>{moveLabel}</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <button
              aria-label={collapsed ? "Expand todo dock" : "Collapse todo dock"}
              className="shrink-0 rounded p-1 text-muted/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`}
              />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>{collapsed ? "Expand" : "Collapse"}</Tooltip.Content>
        </Tooltip>
      </div>

      <div
        className={placement === "right" && !collapsed ? "min-h-0 flex-1 px-1 pb-1" : "px-1 pb-1"}
      >
        <ul
          className={
            collapsed
              ? "space-y-0"
              : placement === "composer"
                ? "max-h-[min(12rem,32vh)] space-y-0 overflow-y-auto [scrollbar-gutter:stable]"
                : "min-h-0 h-full space-y-0 overflow-y-auto [scrollbar-gutter:stable]"
          }
          role="list"
        >
          {displayedSteps.map((step, index) => {
            const originalIndex = collapsed ? state.activeIndex : index;
            const isActive = originalIndex === state.activeIndex;
            const isDone = step.status === "completed";
            return (
              <li
                key={`${state.sourceItemId}:${originalIndex}`}
                ref={isActive ? activeRowRef : undefined}
                aria-current={isActive ? "step" : undefined}
                className={`flex items-center gap-2 rounded px-2 py-1 leading-5 ${isDone ? "opacity-60" : ""} ${isActive && !isDone ? "bg-accent/10" : ""}`}
                role="listitem"
                title={step.text}
              >
                <StatusIcon status={step.status} />
                <span
                  className={`min-w-0 flex-1 truncate leading-5 ${isDone ? "text-foreground-muted" : "text-foreground"}`}
                >
                  {step.text}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function StatusIcon({ status }: { status: ThreadTodoStepStatus }) {
  switch (status) {
    case "completed":
      return <Check aria-label="completed" className="size-3.5 shrink-0 text-foreground-muted" />;
    case "in_progress":
      return (
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
          <PixelLoader size="xxs" className="text-foreground" />
        </span>
      );
    default:
      return (
        <Hourglass aria-label="pending" className="size-3.5 shrink-0 text-foreground-muted/50" />
      );
  }
}
