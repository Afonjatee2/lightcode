import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Project, Thread } from "@/shared/contracts";
import {
  useCurrentThreadIdsCount,
  useHasDraft,
  useIsCurrentProjectDraft,
  useProjectThreads,
} from "@/renderer/hooks/uiSelectors";
import { useDragSource } from "@/renderer/dnd";
import { openNewThread, openNewThreadSideBySide } from "@/renderer/actions/threadActions";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { NewThreadButton } from "./NewThreadButton";
import { groupThreads, type ThreadListEntry, type WorktreeThreadGroup } from "./groupThreads";
import type { ThreadSortMode } from "./sortMode";
import { SidebarThreadGroup } from "./SidebarThreadGroup";
import { SidebarWorktreeGroup } from "./SidebarWorktreeGroup";
import { SortableThreadItem } from "./SortableThreadItem/SortableThreadItem";

const VIRTUAL_OVERSCAN = 12;

type SidebarVirtualRow =
  | {
      kind: "thread";
      key: string;
      thread: Thread;
      threadIndex: number;
      group: string;
      showWorktreeBadge: boolean;
      showWorktreeFilesButton?: boolean;
      sortDisabled?: boolean;
    }
  | {
      kind: "worktree-group";
      key: string;
      group: WorktreeThreadGroup;
      entryIndex: number;
      sortableGroup: string;
      sortDisabled: boolean;
    }
  | {
      kind: "thread-group";
      key: string;
      entry: Extract<ThreadListEntry, { kind: "thread-group" }>;
    }
  | { kind: "divider"; key: string }
  | { kind: "section-label"; key: string; label: string };

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

function entryIsStarred(entry: ThreadListEntry): boolean {
  if (entry.kind === "thread") return entry.thread.starred;
  return entry.group.threads.some((t) => t.starred);
}

function estimateRowSize(row: SidebarVirtualRow | undefined): number {
  if (!row) return 32;
  if (row.kind === "divider") return 10;
  if (row.kind === "section-label") return 28;
  if (row.kind === "worktree-group") return 34;
  if (row.kind === "thread-group") return 30;
  return 30;
}

function pushEntryRows(
  rows: SidebarVirtualRow[],
  entry: ThreadListEntry,
  entryIndex: number,
  input: {
    projectId: string;
    dndGroup: string;
    dndDisabled: boolean;
    collapsedWorktrees: Record<string, boolean>;
    nextUngroupedIndex: () => number;
  },
) {
  if (entry.kind === "thread") {
    const idx = input.nextUngroupedIndex();
    rows.push({
      kind: "thread",
      key: `thread:${entry.thread.id}`,
      thread: entry.thread,
      threadIndex: idx,
      group: input.dndGroup,
      showWorktreeBadge: true,
      showWorktreeFilesButton: !!entry.thread.worktreePath,
      sortDisabled: input.dndDisabled,
    });
    return;
  }

  if (entry.kind === "worktree-group") {
    rows.push({
      kind: "worktree-group",
      key: `wt:${entry.group.worktreePath}`,
      group: entry.group,
      entryIndex,
      sortableGroup: input.dndGroup,
      sortDisabled: input.dndDisabled,
    });
    if (!(input.collapsedWorktrees[entry.group.worktreePath] ?? false)) {
      entry.group.threads.forEach((thread, threadIndex) => {
        rows.push({
          kind: "thread",
          key: `wt:${entry.group.worktreePath}:thread:${thread.id}`,
          thread,
          threadIndex,
          group: `wt:${entry.group.worktreePath}`,
          showWorktreeBadge: false,
          showWorktreeFilesButton: false,
        });
      });
    }
    return;
  }

  const groupKey = entry.group.groupId;
  rows.push({
    kind: "thread-group",
    key: `group:${groupKey}`,
    entry,
  });
  if (!(input.collapsedWorktrees[`group:${groupKey}`] ?? false)) {
    entry.group.threads.forEach((thread, threadIndex) => {
      rows.push({
        kind: "thread",
        key: `group:${groupKey}:thread:${thread.id}`,
        thread,
        threadIndex,
        group: `group:${groupKey}`,
        showWorktreeBadge: !!thread.worktreePath,
        sortDisabled: input.dndDisabled,
      });
    });
  }
}

function buildRows(input: {
  projectId: string;
  projectThreads: Thread[];
  sortMode: ThreadSortMode;
  collapsedWorktrees: Record<string, boolean>;
}): SidebarVirtualRow[] {
  const rows: SidebarVirtualRow[] = [];
  const dndGroup = `project-entries:${input.projectId}`;

  if (input.sortMode === "manual") {
    const orderedThreads = [...input.projectThreads].sort(
      (a, b) => Number(b.starred) - Number(a.starred),
    );
    orderedThreads.forEach((thread, idx) => {
      rows.push({
        kind: "thread",
        key: `thread:${thread.id}`,
        thread,
        threadIndex: idx,
        group: dndGroup,
        showWorktreeBadge: true,
        showWorktreeFilesButton: !!thread.worktreePath,
      });
    });
    return rows;
  }

  const dateField = input.sortMode === "created" ? "createdAt" : "updatedAt";
  const entries = groupThreads(
    [...input.projectThreads].sort((a, b) => b[dateField].localeCompare(a[dateField])),
  );
  const starredEntries = entries.filter(entryIsStarred);
  const unstarredEntries = entries.filter((e) => !entryIsStarred(e));
  const recentEntries = unstarredEntries.filter((e) => isRecent(getEntryDate(e, dateField)));
  const olderEntries = unstarredEntries.filter((e) => !isRecent(getEntryDate(e, dateField)));
  const hasBothSections = recentEntries.length > 0 && olderEntries.length > 0;
  let ungroupedIndex = 0;

  const nextUngroupedIndex = () => ungroupedIndex++;
  const pushList = (list: ThreadListEntry[], offset = 0) => {
    list.forEach((entry, i) => {
      pushEntryRows(rows, entry, offset + i, {
        projectId: input.projectId,
        dndGroup,
        dndDisabled: true,
        collapsedWorktrees: input.collapsedWorktrees,
        nextUngroupedIndex,
      });
      const isLast = i === list.length - 1;
      if (isLast) return;
      if (
        entry.kind === "worktree-group" &&
        !(input.collapsedWorktrees[entry.group.worktreePath] ?? false)
      ) {
        rows.push({ kind: "divider", key: `wt-divider:${entry.group.worktreePath}` });
      } else if (
        entry.kind === "thread-group" &&
        !(input.collapsedWorktrees[`group:${entry.group.groupId}`] ?? false)
      ) {
        rows.push({ kind: "divider", key: `group-divider:${entry.group.groupId}` });
      }
    });
  };

  pushList(starredEntries);
  pushList(recentEntries, starredEntries.length);
  if (hasBothSections) {
    rows.push({ kind: "section-label", key: "older-label", label: "Older" });
  }
  pushList(olderEntries, starredEntries.length + recentEntries.length);

  return rows;
}

export function SidebarProjectThreadList(props: { project: Project; sortMode: ThreadSortMode }) {
  const { project, sortMode } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const projectThreads = useProjectThreads(project.id);
  const collapsedWorktrees = useSidebarUiStore((s) => s.collapsedWorktrees);
  const editingThreadId = useSidebarUiStore((s) => s.editingThreadId);
  const setEditingThreadId = useSidebarUiStore((s) => s.setEditingThreadId);
  const hasDraft = useHasDraft(project.id);
  const currentThreadCount = useCurrentThreadIdsCount();
  const isDraftActive = useIsCurrentProjectDraft(project.id);
  const source = useDragSource();
  const rows = buildRows({
    projectId: project.id,
    projectThreads,
    sortMode,
    collapsedWorktrees,
  });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateRowSize(rows[index]),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: VIRTUAL_OVERSCAN,
    useFlushSync: false,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const firstVisibleStart = virtualItems[0]?.start ?? 0;

  return (
    <div className="space-y-0.5">
      <NewThreadButton
        projectId={project.id}
        hasDraft={hasDraft}
        isActive={isDraftActive}
        isDraggingAnything={!!source}
        canOpenAsPanel={currentThreadCount > 0 && currentThreadCount < 3}
        onPress={() => openNewThread(project.id)}
        onOpenAsPanel={() => openNewThreadSideBySide(project.id)}
      />

      <div ref={scrollRef} className="max-h-80 overflow-y-auto">
        <div className="relative w-full" style={{ height: totalSize }}>
          <div
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${firstVisibleStart}px)` }}
          >
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <SidebarVirtualThreadRow
                  key={virtualRow.key}
                  row={row}
                  index={virtualRow.index}
                  project={project}
                  editingThreadId={editingThreadId}
                  setEditingThreadId={setEditingThreadId}
                  measureElement={virtualizer.measureElement}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarVirtualThreadRow(props: {
  row: SidebarVirtualRow;
  index: number;
  project: Project;
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  measureElement: (element: Element | null) => void;
}) {
  const { row, project, editingThreadId, setEditingThreadId } = props;

  if (row.kind === "thread") {
    return (
      <SortableThreadItem
        thread={row.thread}
        threadIndex={row.threadIndex}
        project={project}
        showWorktreeBadge={row.showWorktreeBadge}
        {...(row.showWorktreeFilesButton !== undefined
          ? { showWorktreeFilesButton: row.showWorktreeFilesButton }
          : {})}
        editingThreadId={editingThreadId}
        setEditingThreadId={setEditingThreadId}
        group={row.group}
        {...(row.sortDisabled !== undefined ? { sortDisabled: row.sortDisabled } : {})}
        virtualIndex={props.index}
        measureElement={props.measureElement}
      />
    );
  }

  return (
    <div ref={props.measureElement} data-index={props.index} className="w-full pb-0.5">
      {row.kind === "worktree-group" ? (
        <SidebarWorktreeGroup
          group={row.group}
          entryIndex={row.entryIndex}
          project={project}
          sortableGroup={row.sortableGroup}
          sortDisabled={row.sortDisabled}
        />
      ) : row.kind === "thread-group" ? (
        <SidebarThreadGroup
          entry={row.entry}
          project={project}
          editingThreadId={editingThreadId}
          setEditingThreadId={setEditingThreadId}
        />
      ) : row.kind === "section-label" ? (
        <div className="px-1.5 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted">
          {row.label}
        </div>
      ) : (
        <div aria-hidden className="mx-1.5 my-1 h-px bg-white/6" />
      )}
    </div>
  );
}
