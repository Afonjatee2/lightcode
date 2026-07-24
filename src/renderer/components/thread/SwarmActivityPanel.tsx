import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CirclePause,
  GitBranch,
  LayoutGrid,
  Loader2,
  Maximize2,
  Network,
} from "lucide-react";
import { useShallow } from "zustand/shallow";
import type { AgentStatus, Thread } from "@/shared/contracts";
import { Button } from "@/renderer/components/common";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";
import { formatModelConfigLabel } from "@/renderer/components/providers/modelDisplay";
import { ThreadProviderIcon } from "@/renderer/components/providers/ThreadProviderIcon";
import { useLiveBackgroundThreadIds, useProjectAgentStatuses } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";

type SwarmChildState = "starting" | "working" | "waiting" | "finished" | "failed";

function childState(thread: Thread, hasBackgroundActivity: boolean): SwarmChildState {
  if (thread.status === "error") return "failed";
  if (thread.status === "needs_approval" || thread.status === "needs_reply") return "waiting";
  if (thread.status === "launching") return "starting";
  if (thread.status === "working" || hasBackgroundActivity) return "working";
  return "finished";
}

function ChildStateLabel({ state }: { state: SwarmChildState }) {
  if (state === "starting") {
    return (
      <span className="flex items-center gap-1 text-muted">
        <Loader2 className="size-3 animate-spin" />
        <Trans>Starting</Trans>
      </span>
    );
  }
  if (state === "working") {
    return (
      <span className="flex items-center gap-1 text-accent">
        <Loader2 className="size-3 animate-spin" />
        <Trans>Working</Trans>
      </span>
    );
  }
  if (state === "waiting") {
    return (
      <span className="flex items-center gap-1 text-warning">
        <CirclePause className="size-3" />
        <Trans>Needs input</Trans>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex items-center gap-1 text-danger">
        <AlertTriangle className="size-3" />
        <Trans>Failed</Trans>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-success">
      <CheckCircle2 className="size-3" />
      <Trans>Finished</Trans>
    </span>
  );
}

function SwarmChildRow(props: {
  thread: Thread;
  agent: AgentStatus | undefined;
  hasBackgroundActivity: boolean;
}) {
  const state = childState(props.thread, props.hasBackgroundActivity);
  const modelLabel = formatModelConfigLabel(props.agent, props.thread.config);
  const providerLabel = props.agent?.label ?? props.thread.agentKind;

  return (
    <button
      type="button"
      className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      onClick={() => useAppStore.getState().openThreadStandalone(props.thread.id)}
    >
      <ThreadProviderIcon thread={props.thread} className="size-4 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground group-hover:underline">
          {props.thread.title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted">
          <span className="truncate">{modelLabel || providerLabel}</span>
          {modelLabel ? (
            <>
              <span className="text-muted/40">·</span>
              <span className="shrink-0">{providerLabel}</span>
            </>
          ) : null}
          {props.thread.worktreeBranch ? (
            <>
              <span className="text-muted/40">·</span>
              <GitBranch className="size-2.5 shrink-0" />
              <span className="truncate font-mono">{props.thread.worktreeBranch}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5 text-[10px]">
        <ChildStateLabel state={state} />
        <RelativeTime iso={props.thread.updatedAt} className="text-muted/70" />
      </span>
    </button>
  );
}

export function SwarmActivityPanel({ parentThread }: { parentThread: Thread }) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(true);
  const projectLocation = useAppStore(
    (state) => state.projects.find((project) => project.id === parentThread.projectId)?.location,
  );
  const agents = useProjectAgentStatuses(projectLocation);
  const children = useAppStore(
    useShallow((state) =>
      state.threads
        .filter(
          (thread) => thread.parentThreadId === parentThread.id && !thread.archived && !thread.done,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ),
  );
  const liveBackgroundThreadIds = useLiveBackgroundThreadIds(children);
  const workingCount = children.filter((thread) => {
    const state = childState(thread, liveBackgroundThreadIds.has(thread.id));
    return state === "starting" || state === "working";
  }).length;
  const finishedCount = children.filter(
    (thread) => childState(thread, liveBackgroundThreadIds.has(thread.id)) === "finished",
  ).length;
  const groupId = parentThread.groupId ?? children[0]?.groupId;
  const showingAll = useAppStore(
    (state) =>
      Boolean(groupId) && state.view.kind === "thread" && state.view.activeGroupId === groupId,
  );

  return (
    <section className="mb-2 shrink-0 overflow-hidden rounded-xl border border-[var(--hairline)] bg-surface-secondary/30">
      <div className="flex min-h-9 items-center gap-2 border-b border-[var(--hairline)] px-2.5 py-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Network className="size-3.5" />
        </span>
        <span className="text-xs font-semibold">
          <Trans>Swarm</Trans>
        </span>
        {children.length > 0 ? (
          <span className="flex min-w-0 items-center gap-2 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <Loader2
                className={`size-2.5 ${workingCount > 0 ? "animate-spin text-accent" : ""}`}
              />
              <span className="tabular-nums">{workingCount}</span>
              <Trans>Working</Trans>
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="size-2.5 text-success" />
              <span className="tabular-nums">{finishedCount}</span>
              <Trans>Finished</Trans>
            </span>
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {groupId && children.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-[10px]"
              onPress={() => {
                const store = useAppStore.getState();
                if (showingAll) {
                  store.openThreadStandalone(parentThread.id);
                } else {
                  store.openGroupGrid(groupId);
                }
              }}
            >
              {showingAll ? <Maximize2 className="size-3" /> : <LayoutGrid className="size-3" />}
              {showingAll ? <Trans>Orchestrator only</Trans> : <Trans>Open All</Trans>}
            </Button>
          ) : null}
          <button
            type="button"
            aria-label={expanded ? t`Collapse` : t`Expand`}
            aria-expanded={expanded}
            className="rounded p-1 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </span>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          {children.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin text-accent" />
              <Trans>Preparing worker assignments…</Trans>
            </div>
          ) : (
            <div className="max-h-52 divide-y divide-[var(--hairline)] overflow-y-auto">
              {children.map((child) => (
                <SwarmChildRow
                  key={child.id}
                  thread={child}
                  agent={agents.find((agent) => agent.kind === child.agentKind)}
                  hasBackgroundActivity={liveBackgroundThreadIds.has(child.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
