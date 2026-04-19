import { useRef } from "react";
import { DevTerminalPanel } from "@/renderer/views/MainView/parts/RightPanel/parts/DevTerminalPanel/DevTerminalPanel";
import { RightPanel } from "@/renderer/views/MainView/parts/RightPanel/RightPanel";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { buildFileEditorContext } from "@/renderer/utils/gitHelpers";

export function MainRightPanel() {
  const terminalPosition = useSharedSettings((s) => s.terminalPosition);
  const gitReviewContext = usePanelStore((s) => s.gitReviewContext);
  const gitReviewAsPanel = usePanelStore((s) => s.gitReviewAsPanel);
  const filesPanelContext = usePanelStore((s) => s.filesPanelContext);

  const isTerminalRight = terminalPosition === "right";
  const gitPanelOpen = !!gitReviewContext && gitReviewAsPanel;
  const filesPanelOpen = filesPanelContext !== null;

  // Keep last valid context so the panel content stays visible during the close animation.
  const lastGitPanelContextRef = useRef(gitReviewContext);
  if (gitReviewContext && gitReviewAsPanel) {
    lastGitPanelContextRef.current = gitReviewContext;
  }
  const gitPanelContext = gitPanelOpen ? gitReviewContext : lastGitPanelContextRef.current;

  const lastFilesPanelContextRef = useRef(filesPanelContext);
  if (filesPanelContext) {
    lastFilesPanelContextRef.current = filesPanelContext;
  }
  const rawFilesPanelContext = filesPanelOpen
    ? filesPanelContext
    : lastFilesPanelContextRef.current;
  const projects = useAppStore((s) => s.projects);
  const resolvedFilesPanelContext = rawFilesPanelContext
    ? (() => {
        const project = projects.find((p) => p.id === rawFilesPanelContext.projectId);
        if (!project) return null;
        return buildFileEditorContext(project, rawFilesPanelContext.worktreePath);
      })()
    : null;

  if (!isTerminalRight) {
    return <DevTerminalPanel />;
  }

  return (
    <RightPanel
      gitPanelContext={gitPanelContext}
      resolvedFilesPanelContext={resolvedFilesPanelContext}
      gitPanelOpen={gitPanelOpen}
      filesPanelOpen={filesPanelOpen}
    />
  );
}
