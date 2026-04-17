import type { ReactNode } from "react";
import { Button, Popover } from "@heroui/react";
import { EllipsisVertical } from "lucide-react";
import { isMac } from "@/renderer/bridge";
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
  onRequestClosePanels?: () => void;
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
    onRequestClosePanels,
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

  const collapsedSidebarHeader = sidebarHeaderChildren ? (
    <Popover>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label="Sidebar actions"
        className="lightcode-overlay-header__controls size-6 min-w-0 text-muted hover:text-foreground"
      >
        <EllipsisVertical className="size-3.5" />
      </Button>
      <Popover.Content placement="right" className="w-auto p-0">
        <Popover.Dialog className="flex items-center gap-1 p-2">
          {sidebarHeaderChildren}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  ) : undefined;

  const contentHeader = <>{contentHeaderChildren}</>;

  return (
    <AppShell
      sidebarHeader={sidebarHeader}
      collapsedSidebarHeader={collapsedSidebarHeader}
      contentHeader={contentHeader}
      sidebar={sidebar}
      content={content}
      rightPanel={rightPanel}
      {...(rightPanelOpen != null ? { rightPanelOpen } : {})}
      gitPanel={gitPanel}
      {...(gitPanelOpen != null ? { gitPanelOpen } : {})}
      {...(onRequestClosePanels != null ? { onRequestClosePanels } : {})}
    />
  );
}
