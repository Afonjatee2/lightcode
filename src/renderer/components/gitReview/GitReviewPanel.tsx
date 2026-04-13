import { useEffect, useState } from "react";
import { GitBranch, Maximize2, PanelRightClose, RefreshCw } from "lucide-react";
import { Tooltip } from "@heroui/react";
import type { Project, ProjectLocation, GitStatusResult } from "../../../shared/contracts";
import { readBridge } from "../../bridge";
import { useGitStore } from "../../state/gitStore";
import { SidebarContext } from "../layout/AppShell";
import { GitReviewSidebar } from "./GitReviewSidebar";

const alwaysExpanded = { isCollapsed: false, collapse: () => {}, expand: () => {} };

export function GitReviewPanel(props: {
  project: Project;
  locationOverride?: ProjectLocation;
  statusKey?: string;
  worktreeBranch?: string | undefined;
  worktreePath?: string | undefined;
  onMergeAndRemove?: (() => void) | undefined;
  onExpandToOverlay: () => void;
  onClose: () => void;
  hideHeader?: boolean;
}) {
  const {
    project,
    locationOverride,
    statusKey,
    worktreeBranch,
    worktreePath,
    onMergeAndRemove,
    onExpandToOverlay,
    onClose,
    hideHeader,
  } = props;
  const effectiveLocation = locationOverride ?? project.location;
  const effectiveProject = locationOverride ? { ...project, location: effectiveLocation } : project;
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedStaged, setSelectedStaged] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const gitStatus = useGitStore((s) =>
    statusKey ? s.worktreeStatuses[statusKey] : s.statuses[project.id],
  ) as GitStatusResult | undefined;

  async function fetchStatus() {
    try {
      const status = await readBridge().getGitStatus({
        projectLocation: effectiveLocation,
      });
      if (statusKey) {
        useGitStore.getState().setWorktreeStatus(statusKey, status);
      } else {
        useGitStore.getState().setStatus(project.id, status);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (gitStatus) return;
    void fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot on mount

  function handleSelectFile(path: string | null, staged: boolean) {
    setSelectedFile(path);
    setSelectedStaged(staged);
  }

  async function handleRefresh() {
    await fetchStatus();
    setRefreshKey((k) => k + 1);
  }

  return (
    <SidebarContext.Provider value={alwaysExpanded}>
      <div className="flex h-full min-h-0 flex-col">
        {/* Header */}
        {!hideHeader && <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[color:var(--border)] px-3">
          <div className="min-w-0">
            <Tooltip delay={300}>
              <Tooltip.Trigger tabIndex={-1} role="none">
                <div className="max-w-[100px] truncate text-xs font-medium text-foreground">{project.name}</div>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">{project.name}</Tooltip.Content>
            </Tooltip>
          </div>
          {gitStatus?.branch && (
            <>
              <GitBranch className="size-3 shrink-0 text-muted/50" />
              <div className="min-w-0">
                <Tooltip delay={300}>
                  <Tooltip.Trigger tabIndex={-1} role="none">
                    <div className="max-w-[100px] truncate text-xs text-muted">{gitStatus.branch}</div>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="bottom">{gitStatus.branch}</Tooltip.Content>
                </Tooltip>
              </div>
              {((gitStatus.behind ?? 0) > 0 || (gitStatus.ahead ?? 0) > 0) && (
                <span className="shrink-0 text-[11px] text-muted/50">
                  ↓{gitStatus.behind ?? 0} ↑{gitStatus.ahead ?? 0}
                </span>
              )}
            </>
          )}
          <div className="flex-1" />
          <button
            type="button"
            className="rounded p-0.5 text-muted hover:text-foreground"
            title="Refresh"
            onClick={() => void handleRefresh()}
          >
            <RefreshCw className="size-3" />
          </button>
          <button
            type="button"
            className="rounded p-0.5 text-muted hover:text-foreground"
            title="Open as page"
            onClick={onExpandToOverlay}
          >
            <Maximize2 className="size-3" />
          </button>
          <button
            type="button"
            className="rounded p-0.5 text-muted hover:text-foreground"
            title="Hide"
            onClick={onClose}
          >
            <PanelRightClose className="size-3" />
          </button>
        </div>}

        {/* Sidebar content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <GitReviewSidebar
            project={effectiveProject}
            gitStatus={gitStatus}
            selectedFile={selectedFile}
            selectedStaged={selectedStaged}
            worktreeBranch={worktreeBranch}
            worktreePath={worktreePath}
            onMergeAndRemove={onMergeAndRemove}
            onSelectFile={handleSelectFile}
            onClose={onClose}
            refreshKey={refreshKey}
            onRefresh={() => void handleRefresh()}
            mode="panel"
          />
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
