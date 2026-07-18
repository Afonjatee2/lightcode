import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { AlertTriangle, Bot, GitBranch, ListChecks, Target, Users } from "lucide-react";
import type { ProjectLocation } from "@/shared/contracts";
import {
  ActiveSubAgentTile,
  useActiveAgentKindCounts,
  type ActiveAgentKind,
} from "@/renderer/components/thread/ChatPane/parts/items/ActiveSubAgentTile";
import { ThreadErrorDock } from "@/renderer/components/thread/ThreadErrorDock";
import { ThreadGoalDock } from "@/renderer/components/thread/ThreadGoalDock";
import { ThreadTodoDock } from "@/renderer/components/thread/ThreadTodoDock";
import type { ThreadDockState } from "@/renderer/components/thread/useThreadDockState";

type ChipKey = ActiveAgentKind | "plan" | "goal" | "errors";

interface ChipDescriptor {
  readonly key: ChipKey;
  readonly icon: React.ElementType<{ className?: string; "aria-hidden"?: boolean }>;
  readonly label: string;
  readonly count?: string;
  readonly tone?: "danger";
}

/**
 * Compact info bubbles floating above the thread composer dock. The full dock
 * sections (subagents, crossagents, workflows, plan, goal, errors) no longer
 * live inside the compact composer (see ThreadComposerSection.hideInfoDocks);
 * each shows here as an icon chip that expands into its dock panel on tap.
 */
export function ComposerInfoChips(props: {
  readonly threadId: string;
  readonly projectLocation: ProjectLocation;
  readonly dockState: ThreadDockState;
  /** Chips duck out of the way while the composer is expanded. */
  readonly hidden: boolean;
}) {
  const { t } = useLingui();
  const { threadId, projectLocation, dockState, hidden } = props;
  const [openChip, setOpenChip] = useState<ChipKey | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const agentCounts = useActiveAgentKindCounts(threadId);
  const todoState = dockState.todoDockState;
  const completedSteps = todoState?.steps.filter((step) => step.status === "completed").length ?? 0;

  const chips: ChipDescriptor[] = [];
  if (agentCounts.subagent > 0) {
    chips.push({
      key: "subagent",
      icon: Bot,
      label: t`Subagents`,
      count: String(agentCounts.subagent),
    });
  }
  if (agentCounts.crossagent > 0) {
    chips.push({
      key: "crossagent",
      icon: Users,
      label: t`Crossagents`,
      count: String(agentCounts.crossagent),
    });
  }
  if (agentCounts.workflow > 0) {
    chips.push({
      key: "workflow",
      icon: GitBranch,
      label: t`Workflows`,
      count: String(agentCounts.workflow),
    });
  }
  if (todoState) {
    chips.push({
      key: "plan",
      icon: ListChecks,
      label: t`Plan`,
      count: `${completedSteps}/${todoState.steps.length}`,
    });
  }
  if (dockState.goalDockState) {
    chips.push({ key: "goal", icon: Target, label: t`Goal` });
  }
  if (dockState.errorDockStates.length > 0) {
    chips.push({
      key: "errors",
      icon: AlertTriangle,
      label: t`Errors`,
      tone: "danger",
      ...(dockState.errorDockStates.length > 1
        ? { count: String(dockState.errorDockStates.length) }
        : {}),
    });
  }

  // Close the panel when its chip disappears (goal dismissed, errors cleared,
  // agents done) or when the view is reused for another thread.
  const chipKeys = chips.map((chip) => chip.key).join(",");
  useEffect(() => {
    setOpenChip((current) =>
      current !== null && !chipKeys.split(",").includes(current) ? null : current,
    );
  }, [chipKeys]);
  useEffect(() => {
    setOpenChip(null);
  }, [threadId]);

  // A tap anywhere outside the chips (list, composer, chrome) closes the panel.
  const panelOpen = openChip !== null;
  useEffect(() => {
    if (!panelOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setOpenChip(null);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [panelOpen]);

  if (chips.length === 0) return null;

  const open = chips.find((chip) => chip.key === openChip) ?? null;

  return (
    <div ref={containerRef} className="m-thread-chips" data-hidden={hidden || undefined}>
      {open ? (
        <div className="m-chip-panel" role="region" aria-label={open.label}>
          {open.key === "goal" && dockState.goalDockState ? (
            <ThreadGoalDock
              state={dockState.goalDockState}
              onDismiss={dockState.onGoalDockDismiss}
            />
          ) : null}
          {open.key === "plan" && todoState ? (
            <ThreadTodoDock
              state={todoState}
              placement="composer"
              collapsed={false}
              canMove={false}
              onCollapsedChange={() => setOpenChip(null)}
              onPlacementChange={dockState.onTodoDockPlacementChange}
              onRetire={dockState.onTodoDockRetire}
            />
          ) : null}
          {open.key === "errors"
            ? dockState.errorDockStates.map((state) => (
                <ThreadErrorDock
                  key={state.sourceItemId}
                  state={state}
                  onDismiss={() => dockState.onDismissError(state.sourceItemId)}
                />
              ))
            : null}
          {open.key === "subagent" || open.key === "crossagent" || open.key === "workflow" ? (
            <ActiveSubAgentTile
              threadId={threadId}
              projectLocation={projectLocation}
              kinds={[open.key]}
            />
          ) : null}
        </div>
      ) : null}
      <div className="m-chip-row">
        {chips.map((chip) => {
          const Icon = chip.icon;
          const isOpen = chip.key === openChip;
          return (
            <button
              key={chip.key}
              type="button"
              className="m-chip"
              data-open={isOpen || undefined}
              data-tone={chip.tone}
              aria-expanded={isOpen}
              aria-label={chip.label}
              title={chip.label}
              onClick={() => setOpenChip(isOpen ? null : chip.key)}
            >
              <Icon className="size-3.5" aria-hidden />
              {chip.count ? <span className="m-chip__count">{chip.count}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
