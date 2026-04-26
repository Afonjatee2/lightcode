import { Tooltip } from "@heroui/react";
import {
  Archive,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  ArrowDownUp,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  Columns2,
  Download,
  FileDiff,
  FolderOpen,
  ExternalLink,
  GripVertical,
  GitFork,
  GitMerge,
  GitPullRequest,
  PanelLeft,
  PanelLeftClose,
  House,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { TuxIcon } from "@/renderer/components/common/TuxIcon";
import { startTransition, useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { getAppName } from "@/shared/appName";
import type { AgentStatus, Project, Thread } from "@/shared/contracts";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/renderer/state/appStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  isGitPanelEclipsed,
  useCurrentProjectId,
  useCurrentThreadIds,
  useInstalledAgents,
} from "@/renderer/hooks/uiSelectors";
import { useSidebarActions } from "@/renderer/views/MainView/parts/Sidebar/parts/SidebarActionsContext";
import {
  useDragSource,
  useIsDraggingProject,
  useIsDraggingThread,
  useIsDraggingWorktreeGroup,
  type DragSourceData,
} from "@/renderer/dnd";
import { ContextMenu, SidebarButton } from "@/renderer/components/common";
import { useSidebar } from "@/renderer/views/MainView/parts/AppShell/AppShell";
import { SIDEBAR_MIN_WIDTH } from "@/renderer/views/MainView/parts/AppShell/parts/useResizablePanels";
import {
  sidebarBodyScrollClass,
  sidebarColumnLayoutClass,
  sidebarFooterNavClass,
} from "@/renderer/components/layout/sidebarChrome";
import { readBridge } from "@/renderer/bridge";
import { formatBytes } from "@/shared/formatBytes";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ProviderIcon, getStatusTone } from "@/renderer/components/providers";
import { resolveActionIcon } from "@/renderer/views/ProjectSettingsOverlay/ProjectSettingsOverlay";
import { useGitStore } from "@/renderer/state/gitStore";
import { GitBadge } from "./parts/GitBadge";
import { SyncBadge } from "./parts/SyncBadge";
import { type GitMenuIcons, useWorktreeGitItems } from "./parts/useWorktreeActions";
import { groupThreads, type ThreadListEntry, type WorktreeThreadGroup } from "./parts/groupThreads";
import { WorktreeGroupHeader } from "./parts/WorktreeGroupHeader";

function formatProjectLocation(project: Project): string {
  if (project.location.kind === "wsl")
    return `${project.location.distro}:${project.location.linuxPath}`;
  return project.location.path;
}

function formatRelativeTime(iso: string): string {
  const deltaMinutes = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }

  return `${Math.floor(deltaHours / 24)}d`;
}

function isRecent(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 24 * 60 * 60 * 1000;
}

function getEntryDate(entry: ThreadListEntry, field: "updatedAt" | "createdAt"): string {
  if (entry.kind === "thread") return entry.thread[field];
  return entry.group.threads.reduce(
    (latest, t) => (t[field] > latest ? t[field] : latest),
    entry.group.threads[0]![field],
  );
}

export type ThreadSortMode = "updated" | "created" | "manual";

export const sortModeOrder: ThreadSortMode[] = ["updated", "created", "manual"];

export const sortModeIcon: Record<ThreadSortMode, typeof ArrowDownUp> = {
  updated: ArrowDownUp,
  created: CalendarClock,
  manual: GripVertical,
};

export const sortModeLabel: Record<ThreadSortMode, string> = {
  updated: "Sort by last updated",
  created: "Sort by created",
  manual: "Manual order",
};

function InlineRenameInput(props: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(props.initialValue);
  const committedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== props.initialValue) {
      props.onCommit(trimmed);
    } else {
      props.onCancel();
    }
  }

  return (
    <input
      ref={inputRef}
      aria-label="Rename thread"
      className="block w-full bg-transparent text-[inherit] leading-[inherit] outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          committedRef.current = true;
          props.onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function UpdateButtons(props: { iconOnly?: boolean }) {
  const { iconOnly = false } = props;
  const updatePhase = useUpdateStore((s) => s.phase);
  const updateVersion = useUpdateStore((s) => s.version);
  const downloadPercent = useUpdateStore((s) => s.downloadPercent);
  const transferred = useUpdateStore((s) => s.downloadTransferred);
  const total = useUpdateStore((s) => s.downloadTotal);
  const bytesPerSecond = useUpdateStore((s) => s.downloadBytesPerSecond);

  if (updatePhase !== "downloading" && updatePhase !== "downloaded") {
    return null;
  }

  if (updatePhase === "downloading") {
    const versionLabel = updateVersion ? ` v${updateVersion}` : "";
    const byteLine =
      transferred != null && total != null && total > 0
        ? `${formatBytes(transferred)} / ${formatBytes(total)}`
        : null;
    const speedLine =
      bytesPerSecond != null && bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : null;

    if (iconOnly) {
      return (
        <Tooltip delay={150}>
          <Tooltip.Trigger>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center">
              <Download className="size-4 animate-pulse text-accent" />
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content placement="right">
            Downloading{versionLabel} — {Math.round(downloadPercent)}%
            {byteLine ? ` · ${byteLine}` : ""}
            {speedLine ? ` · ${speedLine}` : ""}
          </Tooltip.Content>
        </Tooltip>
      );
    }

    return (
      <div className="flex w-full items-center gap-2 rounded-3xl px-2 py-1.5 text-sm text-muted">
        <Download className="size-4 shrink-0 animate-pulse text-accent" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate">
            Downloading{versionLabel} — {Math.round(downloadPercent)}%
            {speedLine ? ` · ${speedLine}` : ""}
          </span>
          {byteLine ? <span className="truncate text-xs opacity-80">{byteLine}</span> : null}
          <div className="h-1 w-full rounded-full bg-white/10">
            <div
              className="h-1 rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.round(downloadPercent)}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // downloaded
  return (
    <SidebarButton
      iconOnly={iconOnly}
      icon={<RefreshCw className="size-4 text-accent" />}
      label={updateVersion ? `Install v${updateVersion}` : "Install update"}
      onPress={() => void readBridge().installUpdate()}
    />
  );
}

function ThreadIcon(props: { thread: Thread }) {
  return (
    <ProviderIcon
      kind={props.thread.agentKind}
      tone={getStatusTone(props.thread)}
      className="size-3.5"
    />
  );
}

// ── Sortable thread item ────────────────────────────────────────
function SortableThreadItem(props: {
  thread: Thread;
  threadIndex: number;
  project: Project;
  showWorktreeBadge: boolean;
  showWorktreeFilesButton?: boolean;
  currentThreadIds: string[];
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  onOpenThread: (threadId: string) => void;
  onUnloadThread: (threadId: string) => void;
  onMarkThreadDone: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onArchiveThread: (threadId: string) => void;
  onDeleteThread: (threadId: string, worktreePath?: string, projectId?: string) => void;
  onOpenFiles: (projectId: string, worktreePath?: string) => void;
  onOpenGitReview: (projectId: string, worktreePath?: string) => void;
  onGitSync: (projectId: string, worktreePath?: string) => void;
  onGitPush: (projectId: string, worktreePath: string) => void;
  onGitPull: (projectId: string, worktreePath: string) => void;
  onGitMergeToSource: (projectId: string, worktreePath: string) => void;
  onGitMergeAndRemove: (projectId: string, worktreePath: string) => void;
  onGitPullFromSource: (projectId: string, worktreePath: string) => void;
  onOpenWorktreeTerminal: (projectId: string, worktreePath: string) => void;
  onRunProjectAction: (projectId: string, actionId: string, worktreePath?: string) => void;
  activeWorktreeTerminalPaths: string[];
  activeWorktreeTerminalPath: string | null;
  activeGitPanelWorktreePath: string | null;
  activeFilesPanelWorktreePath: string | null;
  gitMenuIcons: GitMenuIcons;
  installedAgents: AgentStatus[];
  onContinueInProvider: (threadId: string) => void;
  group: string;
  sortDisabled?: boolean;
}) {
  const {
    thread,
    project,
    showWorktreeBadge,
    showWorktreeFilesButton = false,
    currentThreadIds,
    editingThreadId,
    sortDisabled = false,
  } = props;
  const worktreeGitItems = useWorktreeGitItems(
    thread.projectId,
    thread.worktreePath ?? "",
    props.gitMenuIcons,
  );
  const threadRemoveAction = useSharedSettings((s) => s.threadRemoveAction);
  const unloadDisabledReason =
    thread.status === "inactive"
      ? "Thread is already unloaded."
      : thread.status === "launching"
        ? "Wait for the thread to finish starting."
        : !thread.sessionRef
          ? "This thread can't be resumed yet."
          : undefined;

  const { ref } = useSortable({
    id: `thread:${thread.id}`,
    index: props.threadIndex,
    type: "thread",
    accept: sortDisabled ? [] : ["thread", "worktree-group"],
    group: props.group,
    data: {
      type: "thread",
      threadId: thread.id,
      projectId: thread.projectId,
      ...(thread.worktreePath != null ? { worktreePath: thread.worktreePath } : {}),
    } satisfies DragSourceData,
  });

  const isDragging = useIsDraggingThread(thread.id);

  const isCurrentThread = currentThreadIds.includes(thread.id);
  const statusTone = getStatusTone(thread);

  return (
    <div ref={ref} className="relative">
      <ContextMenu
        items={[
          ...(thread.worktreePath
            ? [
                {
                  type: "submenu" as const,
                  id: "git",
                  label: "Git",
                  icon: <GitFork className="size-3.5" />,
                  items: worktreeGitItems,
                },
              ]
            : []),
          ...(thread.worktreePath && project.scripts?.actions?.length
            ? [
                {
                  type: "submenu" as const,
                  id: "run-action",
                  label: "Run",
                  icon: <Play className="size-3.5" />,
                  items: project.scripts.actions.map((action) => ({
                    id: `action:${action.id}`,
                    label: action.name,
                    icon: resolveActionIcon(action.icon),
                  })),
                },
              ]
            : []),
          {
            id: "rename",
            label: "Rename",
            icon: <Pencil className="size-3.5" />,
          },
          {
            id: "unload",
            label: "Unload Thread",
            icon: <ArrowDownToLine className="size-3.5" />,
            isDisabled: unloadDisabledReason !== undefined,
            ...(unloadDisabledReason ? { disabledReason: unloadDisabledReason } : {}),
          },
          {
            id: "mark-done",
            label: thread.done ? "Unmark Done" : "Mark Done",
            icon: <CircleCheck className="size-3.5" />,
          },
          {
            id: "continue-in",
            label: "Continue in...",
            icon: <ArrowRightLeft className="size-3.5" />,
            isDisabled:
              !thread.sessionRef ||
              props.installedAgents.filter((a) => a.kind !== thread.agentKind).length === 0,
            ...(!thread.sessionRef ||
            props.installedAgents.filter((a) => a.kind !== thread.agentKind).length === 0
              ? {
                  disabledReason: !thread.sessionRef
                    ? "No active session"
                    : "No other agents installed",
                }
              : {}),
          },
          ...(thread.groupId
            ? [
                {
                  id: "ungroup",
                  label: "Remove from group",
                },
              ]
            : []),
          ...(props.currentThreadIds.length >= 2 &&
          props.currentThreadIds.includes(thread.id) &&
          !thread.groupId
            ? [
                {
                  id: "group-open-threads",
                  label: "Group open threads",
                  icon: <Columns2 className="size-3.5" />,
                },
              ]
            : []),
          { type: "separator" as const },
          {
            id: "archive",
            label: "Archive Thread",
            icon: <Archive className="size-3.5" />,
            variant: "warning",
          },
          {
            id: "delete",
            label: "Delete Thread",
            icon: <Trash2 className="size-3.5" />,
            variant: "danger",
          },
        ]}
        onAction={(key) => {
          if (key === "git-review") props.onOpenGitReview(thread.projectId, thread.worktreePath);
          if (key === "git-sync" && thread.worktreePath)
            props.onGitSync(thread.projectId, thread.worktreePath);
          if (key === "git-push" && thread.worktreePath)
            props.onGitPush(thread.projectId, thread.worktreePath);
          if (key === "git-pull" && thread.worktreePath)
            props.onGitPull(thread.projectId, thread.worktreePath);
          if (key === "git-pull-from-source" && thread.worktreePath)
            props.onGitPullFromSource(thread.projectId, thread.worktreePath);
          if (key === "git-merge-to-source" && thread.worktreePath)
            props.onGitMergeToSource(thread.projectId, thread.worktreePath);
          if (key === "git-merge-and-remove" && thread.worktreePath)
            props.onGitMergeAndRemove(thread.projectId, thread.worktreePath);
          if (key === "open-pr" && thread.worktreePath) {
            const pr = useGitStore.getState().prData[thread.worktreePath];
            if (pr?.url) void readBridge().openExternal(pr.url);
          }
          if (key === "create-pr") props.onOpenGitReview(thread.projectId, thread.worktreePath);
          if (key === "continue-in") props.onContinueInProvider(thread.id);
          if (key === "group-open-threads") {
            const state = useAppStore.getState();
            if (state.view.kind !== "thread") return;
            const openThreads = state.threads.filter(
              (t) => state.view.kind === "thread" && state.view.panes.includes(t.id),
            );
            // Only group if all from the same project
            const projectId = openThreads[0]?.projectId;
            if (!projectId || !openThreads.every((t) => t.projectId === projectId)) return;
            const groupId = crypto.randomUUID();
            const groupName = thread.title;
            useAppStore.setState((s) => ({
              threads: s.threads.map((t) =>
                s.view.kind === "thread" && s.view.panes.includes(t.id)
                  ? { ...t, groupId, groupName }
                  : t,
              ),
              view: s.view.kind === "thread" ? { ...s.view, activeGroupId: groupId } : s.view,
            }));
          }
          if (key === "ungroup") {
            useAppStore.setState((state) => {
              let updatedThreads = state.threads.map((t) =>
                t.id === thread.id ? { ...t, groupId: undefined, groupName: undefined } : t,
              );
              // If only 1 thread left in the group, dissolve it
              const remaining = updatedThreads.filter((t) => t.groupId === thread.groupId);
              if (remaining.length === 1) {
                updatedThreads = updatedThreads.map((t) =>
                  t.id === remaining[0]!.id
                    ? { ...t, groupId: undefined, groupName: undefined }
                    : t,
                );
              }
              const view =
                state.view.kind === "thread" && state.view.activeGroupId === thread.groupId
                  ? { kind: "thread" as const, panes: [state.view.panes[0]] as [string] }
                  : state.view;
              return { threads: updatedThreads, view };
            });
          }
          if (key === "archive") props.onArchiveThread(thread.id);
          if (key === "rename") props.setEditingThreadId(thread.id);
          if (key === "unload") props.onUnloadThread(thread.id);
          if (key === "mark-done") props.onMarkThreadDone(thread.id);
          if (key === "delete")
            props.onDeleteThread(thread.id, thread.worktreePath, thread.projectId);
          if (key.startsWith("action:")) {
            props.onRunProjectAction(project.id, key.slice("action:".length), thread.worktreePath);
          }
        }}
      >
        <SidebarButton
          size="xs"
          statusTone={statusTone}
          icon={
            <ProviderIcon kind={thread.agentKind} tone={statusTone} className="size-3.5 shrink-0" />
          }
          label={
            editingThreadId === thread.id ? (
              <InlineRenameInput
                initialValue={thread.title}
                onCommit={(newTitle) => {
                  props.onRenameThread(thread.id, newTitle);
                  props.setEditingThreadId(null);
                }}
                onCancel={() => props.setEditingThreadId(null)}
              />
            ) : thread.done ? (
              <span className="opacity-50 line-through">{thread.title}</span>
            ) : (
              thread.title
            )
          }
          tooltip={editingThreadId === thread.id ? undefined : thread.title}
          isActive={isCurrentThread}
          onPress={() => props.onOpenThread(thread.id)}
          onDoubleClick={() => props.setEditingThreadId(thread.id)}
          isDragging={isDragging}
          suffix={
            <>
              {showWorktreeBadge && thread.worktreePath && (
                <>
                  {showWorktreeFilesButton ? (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Files for ${thread.worktreeBranch ?? thread.title}`}
                      className={`shrink-0 cursor-default rounded p-0.5 transition-colors hover:bg-white/[0.04] hover:text-foreground ${
                        props.activeFilesPanelWorktreePath === thread.worktreePath
                          ? "text-accent"
                          : "text-muted/60 opacity-0 group-hover:opacity-100"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onOpenFiles(thread.projectId, thread.worktreePath);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          props.onOpenFiles(thread.projectId, thread.worktreePath);
                        }
                      }}
                    >
                      <FolderOpen className="size-3.5" />
                    </div>
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Terminal for ${thread.worktreeBranch}`}
                    className={`shrink-0 cursor-default rounded p-0.5 transition-colors hover:bg-white/[0.04] hover:text-foreground ${
                      props.activeWorktreeTerminalPath === thread.worktreePath
                        ? "text-accent"
                        : props.activeWorktreeTerminalPaths.includes(thread.worktreePath)
                          ? "text-foreground"
                          : "text-muted/60 opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onOpenWorktreeTerminal(thread.projectId, thread.worktreePath!);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                        props.onOpenWorktreeTerminal(thread.projectId, thread.worktreePath!);
                      }
                    }}
                  >
                    <TerminalSquare className="size-3.5" />
                  </div>
                  <SyncBadge projectId={thread.projectId} worktreePath={thread.worktreePath} />
                  <GitBadge
                    projectId={thread.projectId}
                    projectName={thread.worktreeBranch ?? ""}
                    worktreePath={thread.worktreePath}
                    onPress={() => props.onOpenGitReview(thread.projectId, thread.worktreePath)}
                    isActive={props.activeGitPanelWorktreePath === thread.worktreePath}
                  />
                  <Tooltip delay={150}>
                    <Tooltip.Trigger tabIndex={-1} role="none">
                      <div className="flex shrink-0 items-center">
                        <GitFork className="size-3 text-muted/60" />
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Content placement="right">
                      Worktree: {thread.worktreeBranch}
                    </Tooltip.Content>
                  </Tooltip>
                </>
              )}
              <span className="relative w-[2.4ch] shrink-0">
                <span className="block text-center font-mono text-[10px] tabular-nums text-muted group-hover:invisible">
                  {formatRelativeTime(thread.updatedAt)}
                </span>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={
                    threadRemoveAction === "archive"
                      ? `Archive ${thread.title}`
                      : `Delete ${thread.title}`
                  }
                  className={`absolute inset-0 flex items-center justify-center rounded text-muted/55 opacity-0 transition group-hover:opacity-100 ${threadRemoveAction === "archive" ? "hover:text-warning" : "hover:text-danger"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (threadRemoveAction === "archive") {
                      props.onArchiveThread(thread.id);
                    } else {
                      props.onDeleteThread(thread.id, thread.worktreePath, thread.projectId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.stopPropagation();
                      if (threadRemoveAction === "archive") {
                        props.onArchiveThread(thread.id);
                      } else {
                        props.onDeleteThread(thread.id, thread.worktreePath, thread.projectId);
                      }
                    }
                  }}
                >
                  {threadRemoveAction === "archive" ? (
                    <Archive className="size-3.5" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </div>
              </span>
            </>
          }
        />
      </ContextMenu>
    </div>
  );
}

// ── Sortable worktree group ─────────────────────────────────────
function SortableWorktreeGroup(props: {
  group: WorktreeThreadGroup;
  entryIndex: number;
  project: Project;
  isCollapsed: boolean;
  collapsedWorktrees: Record<string, boolean>;
  setCollapsedWorktrees: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  currentThreadIds: string[];
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  onOpenThread: (threadId: string) => void;
  onUnloadThread: (threadId: string) => void;
  onMarkThreadDone: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onDeleteThread: (threadId: string, worktreePath?: string, projectId?: string) => void;
  onDeleteWorktreeGroup: (projectId: string, worktreePath: string, threadIds: string[]) => void;
  onOpenFiles: (projectId: string, worktreePath?: string) => void;
  onOpenGitReview: (projectId: string, worktreePath?: string) => void;
  onGitSync: (projectId: string, worktreePath?: string) => void;
  onGitPush: (projectId: string, worktreePath: string) => void;
  onGitPull: (projectId: string, worktreePath: string) => void;
  onGitMergeToSource: (projectId: string, worktreePath: string) => void;
  onGitMergeAndRemove: (projectId: string, worktreePath: string) => void;
  onGitPullFromSource: (projectId: string, worktreePath: string) => void;
  onOpenWorktreeTerminal: (projectId: string, worktreePath: string) => void;
  onRunProjectAction: (projectId: string, actionId: string, worktreePath?: string) => void;
  activeWorktreeTerminalPaths: string[];
  activeWorktreeTerminalPath: string | null;
  activeGitPanelWorktreePath: string | null;
  activeFilesPanelWorktreePath: string | null;
  gitMenuIcons: GitMenuIcons;
  installedAgents: AgentStatus[];
  onContinueInProvider: (threadId: string) => void;
  sortableGroup: string;
  sortDisabled?: boolean;
}) {
  const { group, project, sortDisabled = false } = props;
  const worktreeGitItems = useWorktreeGitItems(project.id, group.worktreePath, props.gitMenuIcons);
  const groupThreadIds = group.threads.map((t) => t.id);

  const { ref } = useSortable({
    id: `wt:${group.worktreePath}`,
    index: props.entryIndex,
    type: "worktree-group",
    accept: sortDisabled ? [] : "worktree-group",
    group: props.sortableGroup,
    data: {
      type: "worktree-group",
      worktreePath: group.worktreePath,
      projectId: project.id,
      threadIds: group.threads.map((t) => t.id),
    } satisfies DragSourceData,
  });

  const source = useDragSource();
  const isDragging = useIsDraggingWorktreeGroup(group.worktreePath);
  const isGroupCollapsed = props.isCollapsed;

  return (
    <div ref={ref} className={`relative space-y-0.5 ${isDragging ? "opacity-60" : ""}`}>
      <ContextMenu
        items={[
          {
            type: "submenu" as const,
            id: "git",
            label: "Git",
            icon: <GitFork className="size-3.5" />,
            items: worktreeGitItems,
          },
          ...(project.scripts?.actions?.length
            ? [
                {
                  type: "submenu" as const,
                  id: "run-action",
                  label: "Run",
                  icon: <Play className="size-3.5" />,
                  items: project.scripts.actions.map((action) => ({
                    id: `action:${action.id}`,
                    label: action.name,
                    icon: resolveActionIcon(action.icon),
                  })),
                },
              ]
            : []),
          {
            id: "delete-worktree",
            label: "Delete Worktree",
            icon: <Trash2 className="size-3.5" />,
            variant: "danger" as const,
          },
        ]}
        onAction={(key) => {
          if (key === "git-review") {
            props.onOpenGitReview(project.id, group.worktreePath);
          }
          if (key === "delete-worktree") {
            props.onDeleteWorktreeGroup(project.id, group.worktreePath, groupThreadIds);
          }
          if (key === "git-sync") {
            props.onGitSync(project.id, group.worktreePath);
          }
          if (key === "git-push") {
            props.onGitPush(project.id, group.worktreePath);
          }
          if (key === "git-pull") {
            props.onGitPull(project.id, group.worktreePath);
          }
          if (key === "git-pull-from-source") {
            props.onGitPullFromSource(project.id, group.worktreePath);
          }
          if (key === "git-merge-to-source") {
            props.onGitMergeToSource(project.id, group.worktreePath);
          }
          if (key === "git-merge-and-remove") {
            props.onGitMergeAndRemove(project.id, group.worktreePath);
          }
          if (key === "open-pr") {
            const pr = useGitStore.getState().prData[group.worktreePath];
            if (pr?.url) void readBridge().openExternal(pr.url);
          }
          if (key === "create-pr") {
            props.onOpenGitReview(project.id, group.worktreePath);
          }
          if (key.startsWith("action:")) {
            props.onRunProjectAction(project.id, key.slice("action:".length), group.worktreePath);
          }
        }}
      >
        <WorktreeGroupHeader
          worktreePath={group.worktreePath}
          worktreeBranch={group.worktreeBranch}
          projectId={project.id}
          isCollapsed={isGroupCollapsed}
          hasTerminal={props.activeWorktreeTerminalPaths.includes(group.worktreePath)}
          isActiveTerminal={props.activeWorktreeTerminalPath === group.worktreePath}
          isActiveFiles={props.activeFilesPanelWorktreePath === group.worktreePath}
          onToggleCollapse={() =>
            props.setCollapsedWorktrees((prev) => ({
              ...prev,
              [group.worktreePath]: !isGroupCollapsed,
            }))
          }
          onOpenFiles={() => props.onOpenFiles(project.id, group.worktreePath)}
          onOpenGitReview={() => props.onOpenGitReview(project.id, group.worktreePath)}
          onOpenTerminal={() => props.onOpenWorktreeTerminal(project.id, group.worktreePath)}
          isDragging={isDragging}
          isDraggingAnything={!!source}
        />
      </ContextMenu>
      {!isGroupCollapsed && (
        <div className="space-y-0.5">
          {group.threads.map((thread, threadIdx) => (
            <SortableThreadItem
              key={thread.id}
              thread={thread}
              threadIndex={threadIdx}
              project={project}
              showWorktreeBadge={false}
              showWorktreeFilesButton={false}
              currentThreadIds={props.currentThreadIds}
              editingThreadId={props.editingThreadId}
              setEditingThreadId={props.setEditingThreadId}
              onOpenThread={props.onOpenThread}
              onUnloadThread={props.onUnloadThread}
              onMarkThreadDone={props.onMarkThreadDone}
              onArchiveThread={props.onArchiveThread}
              onRenameThread={props.onRenameThread}
              onDeleteThread={props.onDeleteThread}
              onOpenFiles={props.onOpenFiles}
              onOpenGitReview={props.onOpenGitReview}
              onGitSync={props.onGitSync}
              onGitPush={props.onGitPush}
              onGitPull={props.onGitPull}
              onGitMergeToSource={props.onGitMergeToSource}
              onGitMergeAndRemove={props.onGitMergeAndRemove}
              onGitPullFromSource={props.onGitPullFromSource}
              onOpenWorktreeTerminal={props.onOpenWorktreeTerminal}
              onRunProjectAction={props.onRunProjectAction}
              activeWorktreeTerminalPaths={props.activeWorktreeTerminalPaths}
              activeWorktreeTerminalPath={props.activeWorktreeTerminalPath}
              activeGitPanelWorktreePath={props.activeGitPanelWorktreePath}
              activeFilesPanelWorktreePath={props.activeFilesPanelWorktreePath}
              gitMenuIcons={props.gitMenuIcons}
              installedAgents={props.installedAgents}
              onContinueInProvider={props.onContinueInProvider}
              group={`wt:${group.worktreePath}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── New thread button with context menu & drag ────────────────
function NewThreadButton(props: {
  projectId: string;
  hasDraft: boolean;
  isActive: boolean;
  isDraggingAnything: boolean;
  canOpenAsPanel: boolean;
  onPress: () => void;
  onOpenAsPanel: () => void;
}) {
  const newThreadRef = useRef<HTMLDivElement>(null);
  useDraggable({
    id: `new-thread:${props.projectId}`,
    type: "new-thread",
    data: { type: "new-thread", projectId: props.projectId } satisfies DragSourceData,
    element: newThreadRef,
  });

  return (
    <ContextMenu
      items={[
        {
          id: "open-as-panel",
          label: "Open as Panel",
          icon: <Columns2 className="size-3.5" />,
          isDisabled: !props.canOpenAsPanel,
        },
      ]}
      onAction={(key) => {
        if (key === "open-as-panel") props.onOpenAsPanel();
      }}
    >
      <SidebarButton
        size="xs"
        liveText
        ref={newThreadRef}
        icon={<Plus className="size-4" />}
        label={props.hasDraft ? "New thread (draft)" : "New thread"}
        isActive={props.isActive}
        isDraggingAnything={props.isDraggingAnything}
        onPress={props.onPress}
        suffix={
          props.hasDraft ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : undefined
        }
      />
    </ContextMenu>
  );
}

// ── Sortable project header ─────────────────────────────────────
function SortableProjectHeader(props: {
  project: Project;
  projectIndex: number;
  isProjectCollapsed: boolean;
  setCollapsedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  collapsedWorktrees: Record<string, boolean>;
  setCollapsedWorktrees: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  currentProjectId: string | undefined;
  currentThreadIds: string[];
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  onOpenNewThread: (projectId?: string) => void;
  onOpenNewThreadSideBySide: (projectId: string) => void;
  onOpenThread: (threadId: string) => void;
  onUnloadThread: (threadId: string) => void;
  onMarkThreadDone: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onDeleteThread: (threadId: string, worktreePath?: string, projectId?: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteWorktreeGroup: (projectId: string, worktreePath: string, threadIds: string[]) => void;
  onOpenSettings: () => void;
  onOpenFiles: (projectId: string, worktreePath?: string) => void;
  onOpenTerminal: (projectId: string) => void;
  onOpenWorktreeTerminal: (projectId: string, worktreePath: string) => void;
  onOpenGitReview: (projectId: string, worktreePath?: string) => void;
  onGitSync: (projectId: string, worktreePath?: string) => void;
  onGitPush: (projectId: string, worktreePath: string) => void;
  onGitPull: (projectId: string, worktreePath: string) => void;
  onGitMergeToSource: (projectId: string, worktreePath: string) => void;
  onGitMergeAndRemove: (projectId: string, worktreePath: string) => void;
  onGitPullFromSource: (projectId: string, worktreePath: string) => void;
  onOpenProjectSettings: (projectId: string) => void;
  onRunProjectAction: (projectId: string, actionId: string, worktreePath?: string) => void;
  terminalProjectIds: string[];
  activeTerminalProjectId: string | null;
  activeWorktreeTerminalPaths: string[];
  activeWorktreeTerminalPath: string | null;
  activeGitPanelProjectId: string | null;
  activeGitPanelWorktreePath: string | null;
  activeFilesPanelProjectId: string | null;
  activeFilesPanelWorktreePath: string | null;
  gitMenuIcons: GitMenuIcons;
  installedAgents: AgentStatus[];
  onContinueInProvider: (threadId: string) => void;
  sortMode: ThreadSortMode;
}) {
  const { project, isProjectCollapsed, sortMode } = props;
  const threads = useAppStore((state) => state.threads);
  const projectThreads = threads.filter(
    (thread) => thread.projectId === project.id && !thread.archived,
  );
  const hasDraft = useAppStore((s) => project.id in s.draftContents);
  const projectLocation = formatProjectLocation(project);

  const { ref } = useSortable({
    id: `project:${project.id}`,
    index: props.projectIndex,
    type: "project",
    accept: "project",
    data: { type: "project", projectId: project.id } satisfies DragSourceData,
  });

  const source = useDragSource();
  const isDragging = useIsDraggingProject(project.id);

  return (
    <section ref={ref} className={`relative space-y-0.5 ${isDragging ? "opacity-60" : ""}`}>
      <ContextMenu
        items={[
          {
            id: "project-settings",
            label: "Project Settings",
            icon: <Settings2 className="size-3.5" />,
          },
          {
            type: "submenu" as const,
            id: "git",
            label: "Git",
            icon: <GitFork className="size-3.5" />,
            items: [
              {
                id: "git-review",
                label: "Review Changes",
                icon: <FileDiff className="size-3.5" />,
              },
              {
                id: "git-sync",
                label: "Sync",
                icon: <RefreshCw className="size-3.5" />,
              },
            ],
          },
          ...(project.scripts?.actions?.length
            ? [
                {
                  type: "submenu" as const,
                  id: "run-action",
                  label: "Run",
                  icon: <Play className="size-3.5" />,
                  items: project.scripts.actions.map((action) => ({
                    id: `action:${action.id}`,
                    label: action.name,
                    icon: resolveActionIcon(action.icon),
                  })),
                },
              ]
            : []),
          {
            id: "remove-project",
            label: "Remove Project",
            icon: <Trash2 className="size-3.5" />,
            variant: "danger" as const,
          },
        ]}
        onAction={(key) => {
          if (key === "project-settings") props.onOpenProjectSettings(project.id);
          if (key === "remove-project") props.onDeleteProject(project.id);
          if (key === "git-review") props.onOpenGitReview(project.id);
          if (key === "git-sync") props.onGitSync(project.id);
          if (key.startsWith("action:")) {
            props.onRunProjectAction(project.id, key.slice("action:".length));
          }
        }}
      >
        <SidebarButton
          icon={
            <ChevronRight
              className={`size-3.5 shrink-0 text-muted transition-transform ${
                isProjectCollapsed ? "" : "rotate-90"
              }`}
            />
          }
          label={
            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold text-foreground">{project.name}</span>
              {project.location.kind === "wsl" && (
                <TuxIcon className="h-3 w-auto shrink-0 text-muted/60" />
              )}
            </span>
          }
          tooltip={projectLocation}
          className={
            isDragging
              ? "lightcode-sidebar-project-nudge !pl-1 opacity-60"
              : "lightcode-sidebar-project-nudge !pl-1"
          }
          onPress={() =>
            props.setCollapsedProjects((current) => ({
              ...current,
              [project.id]: !isProjectCollapsed,
            }))
          }
          isDragging={isDragging}
          suffix={
            <>
              <div
                role="button"
                tabIndex={0}
                aria-label={`Files for ${project.name}`}
                className={`shrink-0 cursor-default rounded p-0.5 transition-colors hover:bg-white/[0.04] hover:text-foreground ${
                  props.activeFilesPanelProjectId === project.id &&
                  !props.activeFilesPanelWorktreePath
                    ? "text-accent"
                    : "text-muted/60 opacity-0 group-hover:opacity-100"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenFiles(project.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    props.onOpenFiles(project.id);
                  }
                }}
              >
                <FolderOpen className="size-3.5" />
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-label={`Terminal for ${project.name}`}
                className={`shrink-0 cursor-default rounded p-0.5 transition-colors hover:bg-white/[0.04] hover:text-foreground ${
                  props.activeTerminalProjectId === project.id
                    ? "text-accent"
                    : props.terminalProjectIds.includes(project.id)
                      ? "text-foreground"
                      : "text-muted/60 opacity-0 group-hover:opacity-100"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenTerminal(project.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    props.onOpenTerminal(project.id);
                  }
                }}
              >
                <TerminalSquare className="size-3.5" />
              </div>
              <SyncBadge projectId={project.id} />
              <GitBadge
                projectId={project.id}
                projectName={project.name}
                onPress={() => props.onOpenGitReview(project.id)}
                isActive={
                  props.activeGitPanelProjectId === project.id && !props.activeGitPanelWorktreePath
                }
              />
            </>
          }
        />
      </ContextMenu>

      {!isProjectCollapsed ? (
        <div className="space-y-0.5">
          <NewThreadButton
            projectId={project.id}
            hasDraft={hasDraft}
            isActive={props.currentProjectId === project.id && props.currentThreadIds.length === 0}
            isDraggingAnything={!!source}
            canOpenAsPanel={props.currentThreadIds.length > 0 && props.currentThreadIds.length < 3}
            onPress={() => props.onOpenNewThread(project.id)}
            onOpenAsPanel={() => props.onOpenNewThreadSideBySide(project.id)}
          />

          <div className="max-h-80 space-y-0.5 overflow-y-auto">
            {(() => {
              const isManual = sortMode === "manual";
              const dndDisabled = !isManual;
              const dndGroup = `project-entries:${project.id}`;

              // Manual mode: flat list, no worktree grouping, no date sections, DnD enabled
              if (isManual) {
                return projectThreads.map((thread, idx) => (
                  <SortableThreadItem
                    key={thread.id}
                    thread={thread}
                    threadIndex={idx}
                    project={project}
                    showWorktreeBadge={true}
                    showWorktreeFilesButton={!!thread.worktreePath}
                    currentThreadIds={props.currentThreadIds}
                    editingThreadId={props.editingThreadId}
                    setEditingThreadId={props.setEditingThreadId}
                    onOpenThread={props.onOpenThread}
                    onUnloadThread={props.onUnloadThread}
                    onMarkThreadDone={props.onMarkThreadDone}
                    onArchiveThread={props.onArchiveThread}
                    onRenameThread={props.onRenameThread}
                    onDeleteThread={props.onDeleteThread}
                    onOpenFiles={props.onOpenFiles}
                    onOpenGitReview={props.onOpenGitReview}
                    onGitSync={props.onGitSync}
                    onGitPush={props.onGitPush}
                    onGitPull={props.onGitPull}
                    onGitMergeToSource={props.onGitMergeToSource}
                    onGitMergeAndRemove={props.onGitMergeAndRemove}
                    onGitPullFromSource={props.onGitPullFromSource}
                    onOpenWorktreeTerminal={props.onOpenWorktreeTerminal}
                    onRunProjectAction={props.onRunProjectAction}
                    activeWorktreeTerminalPaths={props.activeWorktreeTerminalPaths}
                    activeWorktreeTerminalPath={props.activeWorktreeTerminalPath}
                    activeGitPanelWorktreePath={props.activeGitPanelWorktreePath}
                    activeFilesPanelWorktreePath={props.activeFilesPanelWorktreePath}
                    gitMenuIcons={props.gitMenuIcons}
                    installedAgents={props.installedAgents}
                    onContinueInProvider={props.onContinueInProvider}
                    group={dndGroup}
                  />
                ));
              }

              // Date-sorted modes: worktree grouping + Today/Older sections, DnD disabled
              const dateField = sortMode === "created" ? "createdAt" : "updatedAt";
              const entries = groupThreads(
                [...projectThreads].sort((a, b) => b[dateField].localeCompare(a[dateField])),
              );
              const recentEntries = entries.filter((e) => isRecent(getEntryDate(e, dateField)));
              const olderEntries = entries.filter((e) => !isRecent(getEntryDate(e, dateField)));
              const hasBothSections = recentEntries.length > 0 && olderEntries.length > 0;
              let ungroupedIndex = 0;

              const renderEntry = (entry: ThreadListEntry, entryIndex: number) => {
                if (entry.kind === "thread") {
                  const idx = ungroupedIndex++;
                  return (
                    <SortableThreadItem
                      key={entry.thread.id}
                      thread={entry.thread}
                      threadIndex={idx}
                      project={project}
                      showWorktreeBadge={true}
                      showWorktreeFilesButton={!!entry.thread.worktreePath}
                      currentThreadIds={props.currentThreadIds}
                      editingThreadId={props.editingThreadId}
                      setEditingThreadId={props.setEditingThreadId}
                      onOpenThread={props.onOpenThread}
                      onUnloadThread={props.onUnloadThread}
                      onMarkThreadDone={props.onMarkThreadDone}
                      onArchiveThread={props.onArchiveThread}
                      onRenameThread={props.onRenameThread}
                      onDeleteThread={props.onDeleteThread}
                      onOpenFiles={props.onOpenFiles}
                      onOpenGitReview={props.onOpenGitReview}
                      onGitSync={props.onGitSync}
                      onGitPush={props.onGitPush}
                      onGitPull={props.onGitPull}
                      onGitMergeToSource={props.onGitMergeToSource}
                      onGitMergeAndRemove={props.onGitMergeAndRemove}
                      onGitPullFromSource={props.onGitPullFromSource}
                      onOpenWorktreeTerminal={props.onOpenWorktreeTerminal}
                      onRunProjectAction={props.onRunProjectAction}
                      activeWorktreeTerminalPaths={props.activeWorktreeTerminalPaths}
                      activeWorktreeTerminalPath={props.activeWorktreeTerminalPath}
                      activeGitPanelWorktreePath={props.activeGitPanelWorktreePath}
                      activeFilesPanelWorktreePath={props.activeFilesPanelWorktreePath}
                      gitMenuIcons={props.gitMenuIcons}
                      installedAgents={props.installedAgents}
                      onContinueInProvider={props.onContinueInProvider}
                      group={dndGroup}
                      sortDisabled={dndDisabled}
                    />
                  );
                }

                if (entry.kind === "worktree-group") {
                  return (
                    <SortableWorktreeGroup
                      key={entry.group.worktreePath}
                      group={entry.group}
                      entryIndex={entryIndex}
                      project={project}
                      isCollapsed={props.collapsedWorktrees[entry.group.worktreePath] ?? false}
                      collapsedWorktrees={props.collapsedWorktrees}
                      setCollapsedWorktrees={props.setCollapsedWorktrees}
                      currentThreadIds={props.currentThreadIds}
                      editingThreadId={props.editingThreadId}
                      setEditingThreadId={props.setEditingThreadId}
                      onOpenThread={props.onOpenThread}
                      onUnloadThread={props.onUnloadThread}
                      onMarkThreadDone={props.onMarkThreadDone}
                      onArchiveThread={props.onArchiveThread}
                      onRenameThread={props.onRenameThread}
                      onDeleteThread={props.onDeleteThread}
                      onDeleteWorktreeGroup={props.onDeleteWorktreeGroup}
                      onOpenFiles={props.onOpenFiles}
                      onOpenGitReview={props.onOpenGitReview}
                      onGitSync={props.onGitSync}
                      onGitPush={props.onGitPush}
                      onGitPull={props.onGitPull}
                      onGitMergeToSource={props.onGitMergeToSource}
                      onGitMergeAndRemove={props.onGitMergeAndRemove}
                      onGitPullFromSource={props.onGitPullFromSource}
                      onOpenWorktreeTerminal={props.onOpenWorktreeTerminal}
                      onRunProjectAction={props.onRunProjectAction}
                      activeWorktreeTerminalPaths={props.activeWorktreeTerminalPaths}
                      activeWorktreeTerminalPath={props.activeWorktreeTerminalPath}
                      activeGitPanelWorktreePath={props.activeGitPanelWorktreePath}
                      activeFilesPanelWorktreePath={props.activeFilesPanelWorktreePath}
                      gitMenuIcons={props.gitMenuIcons}
                      installedAgents={props.installedAgents}
                      onContinueInProvider={props.onContinueInProvider}
                      sortableGroup={dndGroup}
                      sortDisabled={dndDisabled}
                    />
                  );
                }

                // thread-group: continuation group (threads sharing a groupId)
                const groupKey = entry.group.groupId;
                const isGroupCollapsed = props.collapsedWorktrees[`group:${groupKey}`] ?? false;
                const activeThreads = entry.group.threads.filter((t) => !t.done);
                const isRenamingGroup = props.editingThreadId === `group:${groupKey}`;
                return (
                  <div key={`group:${groupKey}`} className="space-y-0.5">
                    <ContextMenu
                      items={[
                        {
                          id: "open-all",
                          label: "Open All",
                          icon: <Columns2 className="size-3.5" />,
                          isDisabled: activeThreads.length < 2,
                        },
                        {
                          id: "rename-group",
                          label: "Rename Group",
                          icon: <Pencil className="size-3.5" />,
                        },
                        { type: "separator" as const },
                        { id: "ungroup-all", label: "Ungroup All", variant: "warning" },
                      ]}
                      onAction={(key) => {
                        if (key === "open-all") {
                          useAppStore.getState().openGroupView(entry.group.groupId);
                        }
                        if (key === "rename-group") {
                          props.setEditingThreadId(`group:${groupKey}`);
                        }
                        if (key === "ungroup-all") {
                          useAppStore.setState((state) => {
                            const updatedThreads = state.threads.map((t) =>
                              t.groupId === groupKey
                                ? { ...t, groupId: undefined, groupName: undefined }
                                : t,
                            );
                            // Clear group view if this group is currently active
                            const view =
                              state.view.kind === "thread" && state.view.activeGroupId === groupKey
                                ? {
                                    kind: "thread" as const,
                                    panes: [state.view.panes[0]] as [string],
                                  }
                                : state.view;
                            return { threads: updatedThreads, view };
                          });
                        }
                      }}
                    >
                      <div className="flex w-full items-center gap-1 rounded px-1.5 py-1">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-muted transition-colors hover:text-foreground"
                          onClick={() =>
                            props.setCollapsedWorktrees((prev) => ({
                              ...prev,
                              [`group:${groupKey}`]: !isGroupCollapsed,
                            }))
                          }
                        >
                          <ChevronRight
                            className={`size-3 shrink-0 transition-transform ${isGroupCollapsed ? "" : "rotate-90"}`}
                          />
                          {isRenamingGroup ? (
                            <InlineRenameInput
                              initialValue={entry.group.groupName}
                              onCommit={(newName) => {
                                useAppStore.setState((state) => ({
                                  threads: state.threads.map((t) =>
                                    t.groupId === groupKey ? { ...t, groupName: newName } : t,
                                  ),
                                }));
                                props.setEditingThreadId(null);
                              }}
                              onCancel={() => props.setEditingThreadId(null)}
                            />
                          ) : (
                            <>
                              <span className="truncate">{entry.group.groupName}</span>
                              <span className="shrink-0 text-muted/60">
                                {entry.group.threads.length}
                              </span>
                            </>
                          )}
                        </button>
                        {!isRenamingGroup && activeThreads.length >= 2 && (
                          <Tooltip delay={300}>
                            <button
                              type="button"
                              className="shrink-0 rounded p-0.5 text-muted/40 transition-colors hover:bg-white/[0.06] hover:text-foreground"
                              onClick={() => {
                                useAppStore.getState().openGroupView(entry.group.groupId);
                              }}
                            >
                              <Columns2 className="size-3" />
                            </button>
                            <Tooltip.Content>Open all in group</Tooltip.Content>
                          </Tooltip>
                        )}
                      </div>
                    </ContextMenu>
                    {!isGroupCollapsed && (
                      <div className="space-y-0.5">
                        {entry.group.threads.map((thread, threadIdx) => (
                          <SortableThreadItem
                            key={thread.id}
                            thread={thread}
                            threadIndex={threadIdx}
                            project={project}
                            showWorktreeBadge={!!thread.worktreePath}
                            currentThreadIds={props.currentThreadIds}
                            editingThreadId={props.editingThreadId}
                            setEditingThreadId={props.setEditingThreadId}
                            onOpenThread={props.onOpenThread}
                            onUnloadThread={props.onUnloadThread}
                            onMarkThreadDone={props.onMarkThreadDone}
                            onArchiveThread={props.onArchiveThread}
                            onRenameThread={props.onRenameThread}
                            onDeleteThread={props.onDeleteThread}
                            onOpenFiles={props.onOpenFiles}
                            onOpenGitReview={props.onOpenGitReview}
                            onGitSync={props.onGitSync}
                            onGitPush={props.onGitPush}
                            onGitPull={props.onGitPull}
                            onGitMergeToSource={props.onGitMergeToSource}
                            onGitMergeAndRemove={props.onGitMergeAndRemove}
                            onGitPullFromSource={props.onGitPullFromSource}
                            onOpenWorktreeTerminal={props.onOpenWorktreeTerminal}
                            onRunProjectAction={props.onRunProjectAction}
                            activeWorktreeTerminalPaths={props.activeWorktreeTerminalPaths}
                            activeWorktreeTerminalPath={props.activeWorktreeTerminalPath}
                            activeGitPanelWorktreePath={props.activeGitPanelWorktreePath}
                            activeFilesPanelWorktreePath={props.activeFilesPanelWorktreePath}
                            gitMenuIcons={props.gitMenuIcons}
                            installedAgents={props.installedAgents}
                            onContinueInProvider={props.onContinueInProvider}
                            group={`group:${groupKey}`}
                            sortDisabled={dndDisabled}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <>
                  {recentEntries.map((entry, i) => renderEntry(entry, i))}
                  {hasBothSections && (
                    <div className="px-1.5 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      Older
                    </div>
                  )}
                  {olderEntries.map((entry, i) => renderEntry(entry, recentEntries.length + i))}
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ── Main Sidebar ────────────────────────────────────────────────
export function Sidebar() {
  const threads = useAppStore((state) => state.threads);
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useCurrentProjectId();
  const currentThreadIds = useCurrentThreadIds();
  const installedAgents = useInstalledAgents();
  const sortMode = usePanelStore((s) => s.threadSortMode);
  const actions = useSidebarActions();
  const {
    onOpenNewThread,
    onOpenNewThreadSideBySide,
    onOpenThread,
    onUnloadThread,
    onMarkThreadDone,
    onArchiveThread,
    onRenameThread,
    onDeleteThread,
    onDeleteProject,
    onDeleteWorktreeGroup,
    onOpenSettings,
    onOpenFiles,
    onOpenTerminal,
    onOpenWorktreeTerminal,
    onOpenGitReview,
    onGitSync,
    onGitPush,
    onGitPull,
    onGitMergeToSource,
    onGitMergeAndRemove,
    onGitPullFromSource,
    onOpenProjectSettings,
    onRunProjectAction,
    onContinueInProvider,
  } = actions;
  const terminalProjectIds = useDevTerminalStore(
    useShallow((s) => s.tabs.filter((t) => !t.worktreePath).map((t) => t.projectId)),
  );
  const activeTerminalProjectId = useDevTerminalStore((s) =>
    s.isOpen && !s.activeWorktreePath ? s.activeProjectId : null,
  );
  const activeWorktreeTerminalPaths = useDevTerminalStore(
    useShallow((s) => s.tabs.filter((t) => t.worktreePath).map((t) => t.worktreePath as string)),
  );
  const activeWorktreeTerminalPath = useDevTerminalStore((s) =>
    s.isOpen ? s.activeWorktreePath : null,
  );
  const terminalPosition = useSharedSettings((s) => s.terminalPosition);
  const activeGitPanelProjectId = usePanelStore((s) => {
    if (!s.gitReviewAsPanel || !s.gitReviewContext) return null;
    if (isGitPanelEclipsed(terminalPosition, s.rightPanelTab, !!s.filesPanelContext)) return null;
    return s.gitReviewContext.projectId;
  });
  const activeGitPanelWorktreePath = usePanelStore((s) => {
    if (!s.gitReviewAsPanel || !s.gitReviewContext) return null;
    if (isGitPanelEclipsed(terminalPosition, s.rightPanelTab, !!s.filesPanelContext)) return null;
    return s.gitReviewContext.worktreePath ?? null;
  });
  const activeFilesPanelProjectId = usePanelStore((s) =>
    s.rightPanelTab === "files" ? (s.filesPanelContext?.projectId ?? null) : null,
  );
  const activeFilesPanelWorktreePath = usePanelStore((s) =>
    s.rightPanelTab === "files" ? (s.filesPanelContext?.worktreePath ?? null) : null,
  );

  const gitMenuIcons = {
    review: <FileDiff className="size-3.5" />,
    sync: <RefreshCw className="size-3.5" />,
    push: <ArrowUpFromLine className="size-3.5" />,
    pull: <ArrowDownToLine className="size-3.5" />,
    pullFromSource: <ArrowDownToLine className="size-3.5" />,
    merge: <GitMerge className="size-3.5" />,
    openPr: <ExternalLink className="size-3.5" />,
    createPr: <GitPullRequest className="size-3.5" />,
  };

  const { isCollapsed, collapse, expand } = useSidebar();
  const openHome = useAppStore((s) => s.openHome);
  const appNameForHome = getAppName(import.meta.env.DEV);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("lightcode-collapsed-projects");
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      /* ignore */
    }
    return {};
  });
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Record<string, boolean>>({});
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProjectId) {
      return;
    }

    setCollapsedProjects((current) => {
      if (!current[currentProjectId]) {
        return current;
      }

      return {
        ...current,
        [currentProjectId]: false,
      };
    });
  }, [currentProjectId]);

  // Auto-expand worktree group when a thread inside it becomes selected
  useEffect(() => {
    for (const threadId of currentThreadIds) {
      const thread = threads.find((t) => t.id === threadId);
      if (thread?.worktreePath) {
        setCollapsedWorktrees((prev) =>
          prev[thread.worktreePath!] ? { ...prev, [thread.worktreePath!]: false } : prev,
        );
        break;
      }
    }
    // Intentionally omitting collapsedWorktrees — only react to selection changes,
    // not manual collapse actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadIds, threads]);

  useEffect(() => {
    localStorage.setItem("lightcode-collapsed-projects", JSON.stringify(collapsedProjects));
  }, [collapsedProjects]);

  const activeThreads = threads.filter(
    (thread) => thread.status !== "inactive" && !thread.done && !thread.archived,
  );

  return (
    <div className="relative h-full">
      {/* Collapsed icon rail overlay — width 48px, icons centered at 24px (pl-2 + w-8/2) */}
      {isCollapsed && (
        <div className="absolute inset-y-0 left-0 z-10 flex h-full min-h-0 w-12 flex-col items-start gap-3 pl-2 pb-1 pt-0">
          <div className="shrink-0">
            <SidebarButton
              iconOnly
              icon={<House className="size-3.5" />}
              label={appNameForHome}
              onPress={() => startTransition(() => openHome())}
            />
          </div>
          {/* Thread icons — only active threads */}
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {activeThreads.map((thread) => (
              <SidebarButton
                key={thread.id}
                iconOnly
                icon={<ThreadIcon thread={thread} />}
                label={
                  thread.done ? (
                    <span className="opacity-50 line-through">{thread.title}</span>
                  ) : (
                    thread.title
                  )
                }
                isActive={currentThreadIds.includes(thread.id)}
                onPress={() => onOpenThread(thread.id)}
              />
            ))}
          </div>

          {/* Footer icons */}
          <div className="flex flex-col gap-1 border-t border-white/6 pt-2 pr-2">
            <UpdateButtons iconOnly />
            <SidebarButton
              iconOnly
              icon={<Settings2 className="size-4" />}
              label="Settings"
              onPress={onOpenSettings}
            />
            <SidebarButton
              iconOnly
              icon={<PanelLeft className="size-4" />}
              label="Show sidebar"
              onPress={expand}
            />
          </div>
        </div>
      )}

      {/* Full expanded sidebar — icons centered at 24px (branding px-3 + w-6/2, buttons px-4 + w-4/2) */}
      <div
        className={`${sidebarColumnLayoutClass} ${isCollapsed ? "invisible" : ""}`}
        style={{ minWidth: SIDEBAR_MIN_WIDTH }}
      >
        <div className={sidebarBodyScrollClass()}>
          {projects.length === 0 ? (
            <div className="pt-4">
              <p className="text-center text-sm text-muted">Add a project to start</p>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.map((project, projectIndex) => (
                <SortableProjectHeader
                  key={project.id}
                  project={project}
                  projectIndex={projectIndex}
                  isProjectCollapsed={collapsedProjects[project.id] ?? false}
                  setCollapsedProjects={setCollapsedProjects}
                  collapsedWorktrees={collapsedWorktrees}
                  setCollapsedWorktrees={setCollapsedWorktrees}
                  currentProjectId={currentProjectId}
                  currentThreadIds={currentThreadIds}
                  editingThreadId={editingThreadId}
                  setEditingThreadId={setEditingThreadId}
                  onOpenNewThread={onOpenNewThread}
                  onOpenNewThreadSideBySide={onOpenNewThreadSideBySide}
                  onOpenThread={onOpenThread}
                  onUnloadThread={onUnloadThread}
                  onMarkThreadDone={onMarkThreadDone}
                  onArchiveThread={onArchiveThread}
                  onRenameThread={onRenameThread}
                  onDeleteThread={onDeleteThread}
                  onDeleteProject={onDeleteProject}
                  onDeleteWorktreeGroup={onDeleteWorktreeGroup}
                  onOpenSettings={onOpenSettings}
                  onOpenFiles={onOpenFiles}
                  onOpenTerminal={onOpenTerminal}
                  onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                  onOpenGitReview={onOpenGitReview}
                  onGitSync={onGitSync}
                  onGitPush={onGitPush}
                  onGitPull={onGitPull}
                  onGitMergeToSource={onGitMergeToSource}
                  onGitMergeAndRemove={onGitMergeAndRemove}
                  onGitPullFromSource={onGitPullFromSource}
                  onOpenProjectSettings={onOpenProjectSettings}
                  onRunProjectAction={onRunProjectAction}
                  terminalProjectIds={terminalProjectIds}
                  activeTerminalProjectId={activeTerminalProjectId}
                  activeWorktreeTerminalPaths={activeWorktreeTerminalPaths}
                  activeWorktreeTerminalPath={activeWorktreeTerminalPath}
                  activeGitPanelProjectId={activeGitPanelProjectId}
                  activeGitPanelWorktreePath={activeGitPanelWorktreePath}
                  activeFilesPanelProjectId={activeFilesPanelProjectId}
                  activeFilesPanelWorktreePath={activeFilesPanelWorktreePath}
                  gitMenuIcons={gitMenuIcons}
                  installedAgents={installedAgents}
                  onContinueInProvider={onContinueInProvider}
                  sortMode={sortMode}
                />
              ))}
            </div>
          )}
        </div>

        <div className={sidebarFooterNavClass}>
          <UpdateButtons />
          <SidebarButton
            icon={<Settings2 className="size-4" />}
            label="Settings"
            onPress={onOpenSettings}
          />
          <SidebarButton
            icon={<PanelLeftClose className="size-4" />}
            label="Hide sidebar"
            onPress={collapse}
          />
        </div>
      </div>
    </div>
  );
}
