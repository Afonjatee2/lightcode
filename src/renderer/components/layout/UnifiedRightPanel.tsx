import { type ReactNode } from "react";
import { FileDiff, FolderOpen, Maximize2, PanelRightClose, TerminalSquare } from "lucide-react";
import { Tooltip } from "@heroui/react";

export type RightPanelTab = "terminal" | "git" | "files";

export function UnifiedRightPanel(props: {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  terminalContent: ReactNode;
  gitContent: ReactNode;
  filesContent: ReactNode;
  showTerminal: boolean;
  showGit: boolean;
  showFiles: boolean;
  projectName: string | undefined;
  onExpandGitToOverlay?: () => void;
  onExpandFilesToOverlay?: () => void;
  onOpenGit?: () => void;
  onOpenTerminal?: () => void;
  onOpenFiles?: () => void;
  onClose: () => void;
}) {
  const {
    activeTab,
    onTabChange,
    terminalContent,
    gitContent,
    filesContent,
    showTerminal,
    showGit,
    showFiles,
    projectName,
    onExpandGitToOverlay,
    onExpandFilesToOverlay,
    onOpenGit,
    onOpenTerminal,
    onOpenFiles,
    onClose,
  } = props;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-background)]">
      {/* Header bar */}
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] px-3">
        {projectName && (
          <div className="min-w-0">
            <Tooltip delay={300}>
              <Tooltip.Trigger>
                <div className="max-w-[100px] truncate text-xs font-medium text-foreground">
                  {projectName}
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">{projectName}</Tooltip.Content>
            </Tooltip>
          </div>
        )}
        <div className="flex-1" />
        {/* Action buttons */}
        {activeTab === "git" && onExpandGitToOverlay && (
          <button
            type="button"
            className="rounded p-0.5 text-muted hover:text-foreground"
            title="Open as page"
            onClick={onExpandGitToOverlay}
          >
            <Maximize2 className="size-3" />
          </button>
        )}
        {activeTab === "files" && onExpandFilesToOverlay && (
          <button
            type="button"
            className="rounded p-0.5 text-muted hover:text-foreground"
            title="Open as page"
            onClick={onExpandFilesToOverlay}
          >
            <Maximize2 className="size-3" />
          </button>
        )}
        {/* Tab icons */}
        <div className="mx-0.5 h-3 w-px bg-border" />
        <button
          type="button"
          className={`rounded p-0.5 transition-colors ${
            activeTab === "terminal" ? "text-accent" : "text-muted hover:text-foreground"
          }`}
          title="Terminal"
          onClick={() => {
            onTabChange("terminal");
            if (!showTerminal) onOpenTerminal?.();
          }}
        >
          <TerminalSquare className="size-3.5" />
        </button>
        <button
          type="button"
          className={`rounded p-0.5 transition-colors ${
            activeTab === "files" ? "text-accent" : "text-muted hover:text-foreground"
          }`}
          title="Files"
          onClick={() => {
            onTabChange("files");
            if (!showFiles) onOpenFiles?.();
          }}
        >
          <FolderOpen className="size-3.5" />
        </button>
        <button
          type="button"
          className={`rounded p-0.5 transition-colors ${
            activeTab === "git" ? "text-accent" : "text-muted hover:text-foreground"
          }`}
          title="Git"
          onClick={() => {
            onTabChange("git");
            if (!showGit) onOpenGit?.();
          }}
        >
          <FileDiff className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-0.5 text-muted hover:text-foreground"
          title="Hide panel"
          onClick={onClose}
        >
          <PanelRightClose className="size-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={`absolute inset-0 ${activeTab === "terminal" ? "" : "invisible"}`}>
          {terminalContent}
        </div>
        <div className={`absolute inset-0 ${activeTab === "git" ? "" : "invisible"}`}>
          {gitContent}
        </div>
        <div className={`absolute inset-0 ${activeTab === "files" ? "" : "invisible"}`}>
          {filesContent}
        </div>
      </div>
    </div>
  );
}
