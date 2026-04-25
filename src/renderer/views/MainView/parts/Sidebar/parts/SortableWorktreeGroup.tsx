// Adapted from the pre-split Sidebar.tsx SortableWorktreeGroup. Now reads
// callbacks from SidebarActionsContext instead of receiving them as props.
import { GitFork, Play, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/react/sortable";
import type { Project } from "@/shared/contracts";
import { ContextMenu } from "@/renderer/components/common";
import { useDragSource, useIsDraggingWorktreeGroup, type DragSourceData } from "@/renderer/dnd";
import { readBridge } from "@/renderer/bridge";
import { useGitStore } from "@/renderer/state/gitStore";
import { useShallow } from "zustand/shallow";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useDevTerminalStore } from "@/renderer/state/devTerminalStore";
import { resolveActionIcon } from "@/renderer/utils/actionIcons";
import { WorktreeGroupHeader } from "./WorktreeGroupHeader";
import { type GitMenuIcons, useWorktreeGitItems } from "./useWorktreeActions";
import { useSidebarActions } from "./SidebarActionsContext";
import { SortableThreadItem } from "./SortableThreadItem/SortableThreadItem";
import type { WorktreeThreadGroup } from "./groupThreads";

export function SortableWorktreeGroup(props: {
  group: WorktreeThreadGroup;
  entryIndex: number;
  project: Project;
  isCollapsed: boolean;
  setCollapsedWorktrees: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  gitMenuIcons: GitMenuIcons;
  sortableGroup: string;
  sortDisabled?: boolean;
}) {
  const { group, project, sortDisabled = false } = props;
  const actions = useSidebarActions();
  const worktreeGitItems = useWorktreeGitItems(project.id, group.worktreePath, props.gitMenuIcons);
  const groupThreadIds = group.threads.map((t) => t.id);

  const activeWorktreeTerminalPath = useDevTerminalStore((s) =>
    s.isOpen && s.activeProjectId === project.id ? s.activeWorktreePath : null,
  );
  const activeWorktreeTerminalPaths = useDevTerminalStore(
    useShallow((s) =>
      s.tabs
        .filter((t) => t.projectId === project.id && t.worktreePath)
        .map((t) => t.worktreePath as string),
    ),
  );
  const activeFilesPanelWorktreePath = usePanelStore((s) =>
    s.rightPanelTab === "files" && s.filesPanelContext?.projectId === project.id
      ? s.filesPanelContext.worktreePath
      : null,
  );

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
      threadIds: groupThreadIds,
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
          if (key === "git-review") actions.onOpenGitReview(project.id, group.worktreePath);
          else if (key === "delete-worktree")
            actions.onDeleteWorktreeGroup(project.id, group.worktreePath);
          else if (key === "git-sync") actions.onGitSync(project.id, group.worktreePath);
          else if (key === "git-push") actions.onGitPush(project.id, group.worktreePath);
          else if (key === "git-pull") actions.onGitPull(project.id, group.worktreePath);
          else if (key === "git-pull-from-source")
            actions.onGitPullFromSource(project.id, group.worktreePath);
          else if (key === "git-merge-to-source")
            actions.onGitMergeToSource(project.id, group.worktreePath);
          else if (key === "git-merge-and-remove")
            actions.onGitMergeAndRemove(project.id, group.worktreePath);
          else if (key === "open-pr") {
            const pr = useGitStore.getState().prData[group.worktreePath];
            if (pr?.url) void readBridge().openExternal(pr.url);
          } else if (key === "create-pr") actions.onOpenGitReview(project.id, group.worktreePath);
          else if (key.startsWith("action:"))
            actions.onRunProjectAction(project.id, key.slice("action:".length), group.worktreePath);
        }}
      >
        <WorktreeGroupHeader
          worktreePath={group.worktreePath}
          worktreeBranch={group.worktreeBranch}
          projectId={project.id}
          isCollapsed={isGroupCollapsed}
          hasTerminal={activeWorktreeTerminalPaths.includes(group.worktreePath)}
          isActiveTerminal={activeWorktreeTerminalPath === group.worktreePath}
          isActiveFiles={activeFilesPanelWorktreePath === group.worktreePath}
          onToggleCollapse={() =>
            props.setCollapsedWorktrees((prev) => ({
              ...prev,
              [group.worktreePath]: !isGroupCollapsed,
            }))
          }
          onOpenFiles={() => actions.onOpenFiles(project.id, group.worktreePath)}
          onOpenGitReview={() => actions.onOpenGitReview(project.id, group.worktreePath)}
          onOpenTerminal={() => actions.onOpenWorktreeTerminal(project.id, group.worktreePath)}
          isDragging={isDragging}
          isDraggingAnything={!!source}
        />
      </ContextMenu>
      {!isGroupCollapsed && (
        <div className="space-y-0.5 pl-2">
          {group.threads.map((thread, threadIdx) => (
            <SortableThreadItem
              key={thread.id}
              thread={thread}
              threadIndex={threadIdx}
              project={project}
              showWorktreeBadge={false}
              showWorktreeFilesButton={false}
              editingThreadId={props.editingThreadId}
              setEditingThreadId={props.setEditingThreadId}
              gitMenuIcons={props.gitMenuIcons}
              group={`wt:${group.worktreePath}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
