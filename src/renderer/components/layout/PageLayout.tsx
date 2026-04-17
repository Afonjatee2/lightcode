import type { ReactNode } from "react";
import { isMac } from "../../bridge";
import { AppShell } from "./AppShell";

/**
 * Shared page layout: split header (sidebar + content) + AppShell body.
 * Used by the main app, git review overlay, settings overlay, and file editor.
 */
export function PageLayout(props: {
  title: string;
  onTitleClick?: () => void;
  sidebarHeaderChildren?: ReactNode;
  contentHeaderChildren?: ReactNode;
  sidebar: ReactNode;
  content: ReactNode;
  rightPanel?: ReactNode;
  rightPanelOpen?: boolean;
  gitPanel?: ReactNode;
  gitPanelOpen?: boolean;
}) {
  const {
    title,
    onTitleClick,
    sidebarHeaderChildren,
    contentHeaderChildren,
    sidebar,
    content,
    rightPanel,
    rightPanelOpen,
    gitPanel,
    gitPanelOpen,
  } = props;

  const sidebarHeader = (
    <>
      {isMac() && <div className="w-[60px] shrink-0" />}
      {onTitleClick ? (
        <button
          type="button"
          className="lightcode-overlay-header__controls text-xs font-semibold uppercase tracking-[0.12em] text-muted hover:text-foreground transition-colors"
          onClick={onTitleClick}
        >
          {title}
        </button>
      ) : (
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      )}
      {sidebarHeaderChildren}
      <div className="flex-1" />
    </>
  );

  const contentHeader = <>{contentHeaderChildren}</>;

  return (
    <AppShell
      sidebarHeader={sidebarHeader}
      contentHeader={contentHeader}
      sidebar={sidebar}
      content={content}
      rightPanel={rightPanel}
      {...(rightPanelOpen != null ? { rightPanelOpen } : {})}
      gitPanel={gitPanel}
      {...(gitPanelOpen != null ? { gitPanelOpen } : {})}
    />
  );
}
