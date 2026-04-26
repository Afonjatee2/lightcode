import { type CSSProperties, type ReactNode } from "react";
import { FileDiff, FolderOpen, Maximize2, PanelRightClose, TerminalSquare } from "lucide-react";
import { PanelHeaderProjectName } from "@/renderer/components/layout/PanelHeaderProjectName";
import {
  panelHeaderIconButtonClass,
  panelHeaderRowClass,
  panelHeaderTabIconButtonClass,
} from "@/renderer/components/layout/sidebarChrome";

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

  /** Inline opacity/transition so animation is not dropped if Tailwind misses dynamic class strings. */
  const tabLayerStyle = (tab: RightPanelTab): CSSProperties => {
    const on = activeTab === tab;
    return {
      opacity: on ? 1 : 0,
      zIndex: on ? 10 : 0,
      pointerEvents: on ? "auto" : "none",
      transition: "opacity 120ms ease-out",
    };
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-background)]">
      <div className={panelHeaderRowClass}>
        {projectName && <PanelHeaderProjectName name={projectName} maxWidthClass="max-w-[100px]" />}
        <div className="flex-1" />
        {activeTab === "git" && onExpandGitToOverlay && (
          <button
            type="button"
            className={panelHeaderIconButtonClass}
            title="Open as page"
            onClick={onExpandGitToOverlay}
          >
            <Maximize2 className="size-3" />
          </button>
        )}
        {activeTab === "files" && onExpandFilesToOverlay && (
          <button
            type="button"
            className={panelHeaderIconButtonClass}
            title="Open as page"
            onClick={onExpandFilesToOverlay}
          >
            <Maximize2 className="size-3" />
          </button>
        )}
        <div className="mx-0.5 h-3 w-px bg-border" />
        <button
          type="button"
          className={panelHeaderTabIconButtonClass(activeTab === "terminal")}
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
          className={panelHeaderTabIconButtonClass(activeTab === "files")}
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
          className={panelHeaderTabIconButtonClass(activeTab === "git")}
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
          className={panelHeaderIconButtonClass}
          title="Hide panel"
          onClick={onClose}
        >
          <PanelRightClose className="size-3.5" />
        </button>
      </div>

      {/* Content — stacked layers cross-fade on tab change */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden" style={tabLayerStyle("terminal")}>
          {terminalContent}
        </div>
        <div className="absolute inset-0 overflow-hidden" style={tabLayerStyle("git")}>
          {gitContent}
        </div>
        <div className="absolute inset-0 overflow-hidden" style={tabLayerStyle("files")}>
          {filesContent}
        </div>
      </div>
    </div>
  );
}
