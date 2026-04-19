import { ChevronRight, FileDiff, GitFork, Play, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { TuxIcon } from "@/renderer/components/common/TuxIcon";
import { useSortable } from "@dnd-kit/react/sortable";
import type { Project } from "@/shared/contracts";

import { useDragSource, useIsDraggingProject, type DragSourceData } from "@/renderer/dnd";
import { ContextMenu, SidebarButton } from "@/renderer/components/common";
import { resolveActionIcon } from "@/renderer/utils/actionIcons";
import type { GitMenuIcons } from "@/renderer/views/MainView/parts/Sidebar/parts/useWorktreeActions";
import {
  groupThreads,
  type ThreadListEntry,
} from "@/renderer/views/MainView/parts/Sidebar/parts/groupThreads";
import type { ThreadSortMode } from "../sortMode";
import { isRecent } from "@/renderer/utils/formatTime";
import { SortableThreadItem } from "../SortableThreadItem/SortableThreadItem";
import { SortableWorktreeGroup } from "../SortableWorktreeGroup";
import { NewThreadButton } from "../NewThreadButton";
import { formatProjectLocation } from "../formatProjectLocation";
import {
  useCurrentProjectId,
  useCurrentThreadIdsCount,
  useHasDraft,
  useProjectThreads,
} from "@/renderer/hooks/uiSelectors";
import { openGitReview, openProjectSettings } from "@/renderer/actions/panelActions";
import { deleteProject } from "@/renderer/actions/projectActions";
import { gitSync } from "@/renderer/actions/gitActions";
import { runProjectAction } from "@/renderer/actions/terminalActions";
import { openNewThread, openNewThreadSideBySide } from "@/renderer/actions/threadActions";
import { ThreadGroupRow } from "./parts/ThreadGroupRow";
import { ProjectHeaderSuffix } from "./parts/ProjectHeaderSuffix";

function getEntryDate(entry: ThreadListEntry, field: "updatedAt" | "createdAt"): string {
  if (entry.kind === "thread") return entry.thread[field];
  return entry.group.threads.reduce(
    (latest, t) => (t[field] > latest ? t[field] : latest),
    entry.group.threads[0]![field],
  );
}

export function SortableProjectHeader(props: {
  project: Project;
  projectIndex: number;
  isProjectCollapsed: boolean;
  setCollapsedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  collapsedWorktrees: Record<string, boolean>;
  setCollapsedWorktrees: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  gitMenuIcons: GitMenuIcons;
  sortMode: ThreadSortMode;
}) {
  const { project, isProjectCollapsed, sortMode } = props;
  const projectThreads = useProjectThreads(project.id);
  const hasDraft = useHasDraft(project.id);
  const projectLocation = formatProjectLocation(project);
  const currentProjectId = useCurrentProjectId();
  const currentThreadCount = useCurrentThreadIdsCount();

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
          if (key === "project-settings") openProjectSettings(project.id);
          if (key === "remove-project") deleteProject(project.id);
          if (key === "git-review") openGitReview(project.id);
          if (key === "git-sync") gitSync(project.id);
          if (key.startsWith("action:")) {
            runProjectAction(project.id, key.slice("action:".length));
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
              <span className="truncate font-semibold text-foreground">{project.name}</span>
              {project.location.kind === "wsl" && (
                <TuxIcon className="h-3 w-auto shrink-0 text-muted/60" />
              )}
            </span>
          }
          tooltip={projectLocation}
          className={isDragging ? "opacity-60" : ""}
          onPress={() =>
            props.setCollapsedProjects((current) => ({
              ...current,
              [project.id]: !isProjectCollapsed,
            }))
          }
          isDragging={isDragging}
          suffix={<ProjectHeaderSuffix project={project} />}
        />
      </ContextMenu>

      {!isProjectCollapsed ? (
        <div className="space-y-0.5 pl-3">
          <NewThreadButton
            projectId={project.id}
            hasDraft={hasDraft}
            isActive={currentProjectId === project.id && currentThreadCount === 0}
            isDraggingAnything={!!source}
            canOpenAsPanel={currentThreadCount > 0 && currentThreadCount < 3}
            onPress={() => openNewThread(project.id)}
            onOpenAsPanel={() => openNewThreadSideBySide(project.id)}
          />

          <div className="max-h-80 space-y-0.5 overflow-y-auto">
            {(() => {
              const isManual = sortMode === "manual";
              const dndDisabled = !isManual;
              const dndGroup = `project-entries:${project.id}`;

              if (isManual) {
                return projectThreads.map((thread, idx) => (
                  <SortableThreadItem
                    key={thread.id}
                    thread={thread}
                    threadIndex={idx}
                    project={project}
                    showWorktreeBadge={true}
                    showWorktreeFilesButton={!!thread.worktreePath}
                    editingThreadId={props.editingThreadId}
                    setEditingThreadId={props.setEditingThreadId}
                    gitMenuIcons={props.gitMenuIcons}
                    group={dndGroup}
                  />
                ));
              }

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
                      editingThreadId={props.editingThreadId}
                      setEditingThreadId={props.setEditingThreadId}
                      gitMenuIcons={props.gitMenuIcons}
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
                      setCollapsedWorktrees={props.setCollapsedWorktrees}
                      editingThreadId={props.editingThreadId}
                      setEditingThreadId={props.setEditingThreadId}
                      gitMenuIcons={props.gitMenuIcons}
                      sortableGroup={dndGroup}
                      sortDisabled={dndDisabled}
                    />
                  );
                }

                const groupKey = entry.group.groupId;
                const isGroupCollapsed = props.collapsedWorktrees[`group:${groupKey}`] ?? false;
                const isRenamingGroup = props.editingThreadId === `group:${groupKey}`;
                return (
                  <ThreadGroupRow
                    key={`group:${groupKey}`}
                    group={entry.group}
                    project={project}
                    isGroupCollapsed={isGroupCollapsed}
                    isRenamingGroup={isRenamingGroup}
                    dndDisabled={dndDisabled}
                    editingThreadId={props.editingThreadId}
                    setEditingThreadId={props.setEditingThreadId}
                    setCollapsedWorktrees={props.setCollapsedWorktrees}
                    gitMenuIcons={props.gitMenuIcons}
                  />
                );
              };

              return (
                <>
                  {recentEntries.map((entry, i) => renderEntry(entry, i))}
                  {hasBothSections && (
                    <div className="px-2 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted">
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
