import { type CSSProperties, type ReactNode } from "react";
import {
  FileDiff,
  FolderOpen,
  Gauge,
  Globe,
  Maximize2,
  NotebookPen,
  PanelRightClose,
  PictureInPicture2,
  TerminalSquare,
  Waypoints,
} from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { PanelHeaderProjectName } from "@/renderer/components/layout/PanelHeaderProjectName";
import {
  panelHeaderIconButtonClass,
  panelHeaderRowClass,
  panelHeaderTabIconButtonClass,
} from "@/renderer/components/layout/sidebarChrome";
import type { RightPanelTab } from "@/renderer/state/panelStore";

export type { RightPanelTab };

export function UnifiedRightPanel(props: {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  terminalContent?: ReactNode;
  gitContent: ReactNode;
  filesContent: ReactNode;
  browserContent: ReactNode;
  usageContent?: ReactNode;
  notesContent?: ReactNode;
  portsContent?: ReactNode;
  /** Tab-specific action buttons rendered in the header when the usage tab is active. */
  usageHeaderActions?: ReactNode;
  showTerminalTab?: boolean;
  showFilesTab?: boolean;
  showGitTab?: boolean;
  showUsageTab?: boolean;
  showNotesTab?: boolean;
  showPortsTab?: boolean;
  showBrowserTab?: boolean;
  projectName: string | undefined;
  onExpandGitToOverlay?: () => void;
  onExpandFilesToOverlay?: () => void;
  onExpandBrowserToOverlay?: () => void;
  onExtractBrowserToWindow?: () => void;
  onOpenGit?: () => void;
  onOpenTerminal?: () => void;
  onOpenFiles?: () => void;
  onOpenBrowser?: () => void;
  onOpenUsage?: () => void;
  onOpenNotes?: () => void;
  onOpenPorts?: () => void;
  onClose: () => void;
}) {
  const {
    activeTab,
    onTabChange,
    terminalContent,
    gitContent,
    filesContent,
    browserContent,
    usageContent,
    notesContent,
    portsContent,
    usageHeaderActions,
    showTerminalTab = true,
    showFilesTab = true,
    showGitTab = true,
    showUsageTab = true,
    showNotesTab = true,
    showPortsTab = false,
    showBrowserTab = true,
    projectName,
    onExpandGitToOverlay,
    onExpandFilesToOverlay,
    onExpandBrowserToOverlay,
    onExtractBrowserToWindow,
    onOpenGit,
    onOpenTerminal,
    onOpenFiles,
    onOpenBrowser,
    onOpenUsage,
    onOpenNotes,
    onOpenPorts,
    onClose,
  } = props;
  const { t } = useLingui();

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

  const dragCtl = "poracode-overlay-header__controls";
  const tabs = [
    {
      id: "terminal",
      label: t`Terminal`,
      icon: TerminalSquare,
      content: terminalContent,
      visible: showTerminalTab,
      onOpen: onOpenTerminal,
    },
    {
      id: "files",
      label: t`Files`,
      icon: FolderOpen,
      content: filesContent,
      visible: showFilesTab,
      onOpen: onOpenFiles,
    },
    {
      id: "git",
      label: t`Git`,
      icon: FileDiff,
      content: gitContent,
      visible: showGitTab,
      onOpen: onOpenGit,
    },
    {
      id: "usage",
      label: t`Usage`,
      icon: Gauge,
      content: usageContent,
      visible: showUsageTab,
      onOpen: onOpenUsage,
    },
    {
      id: "notes",
      label: t`Notes`,
      icon: NotebookPen,
      content: notesContent,
      visible: showNotesTab,
      onOpen: onOpenNotes,
    },
    {
      id: "ports",
      label: t`Ports`,
      icon: Waypoints,
      content: portsContent,
      visible: showPortsTab,
      onOpen: onOpenPorts,
    },
    {
      id: "browser",
      label: t`Browser`,
      icon: Globe,
      content: browserContent,
      visible: showBrowserTab,
      onOpen: onOpenBrowser,
    },
  ] as const;

  return (
    <div
      data-poracode-panel=""
      className="flex h-full min-h-0 flex-col bg-[var(--content-background)]"
    >
      <div className={`poracode-overlay-header ${panelHeaderRowClass}`}>
        {projectName && (
          <PanelHeaderProjectName
            name={projectName}
            maxWidthClass="max-w-[100px]"
            triggerClassName={dragCtl}
          />
        )}
        <div className="flex-1" />
        {activeTab === "git" && onExpandGitToOverlay && (
          <button
            type="button"
            className={`${dragCtl} ${panelHeaderIconButtonClass}`}
            title={t`Maximize`}
            onClick={onExpandGitToOverlay}
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
        {activeTab === "files" && onExpandFilesToOverlay && (
          <button
            type="button"
            className={`${dragCtl} ${panelHeaderIconButtonClass}`}
            title={t`Maximize`}
            onClick={onExpandFilesToOverlay}
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
        {activeTab === "browser" && onExpandBrowserToOverlay && (
          <button
            type="button"
            className={`${dragCtl} ${panelHeaderIconButtonClass}`}
            title={t`Maximize`}
            onClick={onExpandBrowserToOverlay}
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
        {activeTab === "browser" && onExtractBrowserToWindow && (
          <button
            type="button"
            className={`${dragCtl} ${panelHeaderIconButtonClass}`}
            title={t`Move browser to window`}
            onClick={onExtractBrowserToWindow}
          >
            <PictureInPicture2 className="size-3.5" />
          </button>
        )}
        {activeTab === "usage" ? usageHeaderActions : null}
        <div className="mx-0.5 h-3 w-px bg-border" />
        {tabs.map((tab) => {
          if (!tab.visible) return null;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`${dragCtl} ${panelHeaderTabIconButtonClass(activeTab === tab.id)}`}
              title={tab.label}
              onClick={() => {
                if (tab.onOpen) tab.onOpen();
                else onTabChange(tab.id);
              }}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
        <button
          type="button"
          className={`${dragCtl} ${panelHeaderIconButtonClass}`}
          title={t`Hide panel`}
          onClick={onClose}
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {/* Content — stacked layers cross-fade on tab change */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.map((tab) =>
          tab.visible ? (
            <div
              key={tab.id}
              className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
              style={tabLayerStyle(tab.id)}
            >
              {tab.content}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
