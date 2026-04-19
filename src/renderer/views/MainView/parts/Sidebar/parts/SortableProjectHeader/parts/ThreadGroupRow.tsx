import { ChevronRight, Columns2, Pencil } from "lucide-react";
import { Tooltip } from "@heroui/react";
import type { Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { ContextMenu } from "@/renderer/components/common";
import type { GitMenuIcons } from "@/renderer/views/MainView/parts/Sidebar/parts/useWorktreeActions";
import type { WorktreeThreadGroup } from "@/renderer/views/MainView/parts/Sidebar/parts/groupThreads";
import { InlineRenameInput } from "../../InlineRenameInput";
import { SortableThreadItem } from "../../SortableThreadItem/SortableThreadItem";

export function ThreadGroupRow(props: {
  group: {
    groupId: string;
    groupName: string;
    threads: WorktreeThreadGroup["threads"];
  };
  project: Project;
  isGroupCollapsed: boolean;
  isRenamingGroup: boolean;
  dndDisabled: boolean;
  editingThreadId: string | null;
  setEditingThreadId: (id: string | null) => void;
  setCollapsedWorktrees: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  gitMenuIcons: GitMenuIcons;
}) {
  const {
    group,
    project,
    isGroupCollapsed,
    isRenamingGroup,
    dndDisabled,
    editingThreadId,
    setEditingThreadId,
    setCollapsedWorktrees,
    gitMenuIcons,
  } = props;

  const groupKey = group.groupId;
  const activeThreads = group.threads.filter((t) => !t.done);

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
            useAppStore.getState().openGroupView(group.groupId);
          }
          if (key === "rename-group") {
            setEditingThreadId(`group:${groupKey}`);
          }
          if (key === "ungroup-all") {
            useAppStore.setState((state) => {
              const updatedThreads = state.threads.map((t) =>
                t.groupId === groupKey ? { ...t, groupId: undefined, groupName: undefined } : t,
              );
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
        <div className="flex w-full items-center gap-1 rounded px-2 py-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-muted transition-colors hover:text-foreground"
            onClick={() =>
              setCollapsedWorktrees((prev) => ({
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
                initialValue={group.groupName}
                onCommit={(newName) => {
                  useAppStore.setState((state) => ({
                    threads: state.threads.map((t) =>
                      t.groupId === groupKey ? { ...t, groupName: newName } : t,
                    ),
                  }));
                  setEditingThreadId(null);
                }}
                onCancel={() => setEditingThreadId(null)}
              />
            ) : (
              <>
                <span className="truncate">{group.groupName}</span>
                <span className="shrink-0 text-muted/60">{group.threads.length}</span>
              </>
            )}
          </button>
          {!isRenamingGroup && activeThreads.length >= 2 && (
            <Tooltip delay={300}>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-muted/40 transition-colors hover:bg-white/[0.06] hover:text-foreground"
                onClick={() => {
                  useAppStore.getState().openGroupView(group.groupId);
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
        <div className="space-y-0.5 pl-2">
          {group.threads.map((thread, threadIdx) => (
            <SortableThreadItem
              key={thread.id}
              thread={thread}
              threadIndex={threadIdx}
              project={project}
              showWorktreeBadge={!!thread.worktreePath}
              editingThreadId={editingThreadId}
              setEditingThreadId={setEditingThreadId}
              gitMenuIcons={gitMenuIcons}
              group={`group:${groupKey}`}
              sortDisabled={dndDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
