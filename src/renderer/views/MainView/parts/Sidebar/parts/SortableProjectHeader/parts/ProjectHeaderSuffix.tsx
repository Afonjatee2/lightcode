import { FolderOpen, TerminalSquare } from "lucide-react";
import type { Project } from "@/shared/contracts";
import { GitBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/GitBadge";
import { SyncBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/SyncBadge";
import { openFilesPanel, openGitReview } from "@/renderer/actions/panelActions";
import { openTerminal } from "@/renderer/actions/terminalActions";
import {
  useIsProjectFilesPanelActive,
  useIsProjectGitPanelActive,
  useIsProjectTerminalActive,
  useIsProjectTerminalOpen,
} from "@/renderer/hooks/uiSelectors";

export function ProjectHeaderSuffix(props: { project: Project }) {
  const { project } = props;
  const isFilesActive = useIsProjectFilesPanelActive(project.id);
  const isGitActive = useIsProjectGitPanelActive(project.id);
  const isTerminalActive = useIsProjectTerminalActive(project.id);
  const isTerminalOpen = useIsProjectTerminalOpen(project.id);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Files for ${project.name}`}
        className={`shrink-0 cursor-default rounded p-0.5 transition-colors hover:bg-white/[0.04] hover:text-foreground ${
          isFilesActive ? "text-accent" : "text-muted/60 opacity-0 group-hover:opacity-100"
        }`}
        onClick={(event) => {
          event.stopPropagation();
          openFilesPanel(project.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
            openFilesPanel(project.id);
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
          isTerminalActive
            ? "text-accent"
            : isTerminalOpen
              ? "text-foreground"
              : "text-muted/60 opacity-0 group-hover:opacity-100"
        }`}
        onClick={(event) => {
          event.stopPropagation();
          openTerminal(project.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
            openTerminal(project.id);
          }
        }}
      >
        <TerminalSquare className="size-3.5" />
      </div>
      <SyncBadge projectId={project.id} />
      <GitBadge
        projectId={project.id}
        projectName={project.name}
        onPress={() => openGitReview(project.id)}
        isActive={isGitActive}
      />
    </>
  );
}
