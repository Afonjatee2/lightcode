import { Tooltip } from "@heroui/react";
import { Archive, FolderOpen, GitFork, Star, TerminalSquare, Trash2 } from "lucide-react";
import type { Thread } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { GitBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/GitBadge";
import { SyncBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/SyncBadge";
import { archiveThread, deleteThread } from "@/renderer/actions/threadActions";
import { openFilesPanel, openGitReview } from "@/renderer/actions/panelActions";
import { openWorktreeTerminal } from "@/renderer/actions/terminalActions";
import {
  useIsWorktreeFilesPanelActive,
  useIsWorktreeGitPanelActive,
  useIsWorktreeTerminalActive,
  useIsWorktreeTerminalOpen,
} from "@/renderer/hooks/uiSelectors";
import { formatRelativeTime } from "@/renderer/utils/formatTime";

export function ThreadItemSuffix(props: {
  thread: Thread;
  showWorktreeBadge: boolean;
  showWorktreeFilesButton: boolean;
}) {
  const { thread, showWorktreeBadge, showWorktreeFilesButton } = props;
  const threadRemoveAction = useSharedSettings((s) => s.threadRemoveAction);
  const isFilesActive = useIsWorktreeFilesPanelActive(thread.worktreePath);
  const isGitActive = useIsWorktreeGitPanelActive(thread.worktreePath);
  const isTerminalActive = useIsWorktreeTerminalActive(thread.worktreePath);
  const isTerminalOpen = useIsWorktreeTerminalOpen(thread.worktreePath);

  return (
    <>
      {thread.starred && <Star className="size-3 shrink-0 fill-current" aria-label="Pinned" />}
      {showWorktreeBadge && thread.worktreePath && (
        <>
          {showWorktreeFilesButton ? (
            <div
              role="button"
              tabIndex={0}
              aria-label={`Files for ${thread.worktreeBranch ?? thread.title}`}
              className={`shrink-0 cursor-default rounded p-0.5 transition-colors hover:bg-white/[0.04] hover:text-foreground ${
                isFilesActive ? "text-accent" : "text-muted/60 opacity-0 group-hover:opacity-100"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                openFilesPanel(thread.projectId, thread.worktreePath);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                  openFilesPanel(thread.projectId, thread.worktreePath);
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
              isTerminalActive
                ? "text-accent"
                : isTerminalOpen
                  ? "text-foreground"
                  : "text-muted/60 opacity-0 group-hover:opacity-100"
            }`}
            onClick={(event) => {
              event.stopPropagation();
              openWorktreeTerminal(thread.projectId, thread.worktreePath!);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
                openWorktreeTerminal(thread.projectId, thread.worktreePath!);
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
            onPress={() => openGitReview(thread.projectId, thread.worktreePath)}
            isActive={isGitActive}
          />
          <Tooltip delay={150}>
            <Tooltip.Trigger tabIndex={-1} role="none">
              <div className="flex shrink-0 items-center">
                <GitFork className="size-3 text-muted/60" />
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content placement="right">Worktree: {thread.worktreeBranch}</Tooltip.Content>
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
            threadRemoveAction === "archive" ? `Archive ${thread.title}` : `Delete ${thread.title}`
          }
          className={`absolute inset-0 flex items-center justify-center rounded text-muted/55 opacity-0 transition group-hover:opacity-100 ${threadRemoveAction === "archive" ? "hover:text-warning" : "hover:text-danger"}`}
          onClick={(event) => {
            event.stopPropagation();
            if (threadRemoveAction === "archive") {
              archiveThread(thread.id);
            } else {
              deleteThread(thread.id, thread.worktreePath, thread.projectId);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation();
              if (threadRemoveAction === "archive") {
                archiveThread(thread.id);
              } else {
                deleteThread(thread.id, thread.worktreePath, thread.projectId);
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
  );
}
