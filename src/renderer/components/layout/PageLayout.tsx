import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { isMac, isWindows } from "@/renderer/bridge";
import { macosTrafficLightGutterClass } from "@/renderer/components/layout/sidebarChrome";
import { AppShell, useSidebar } from "@/renderer/views/MainView/parts/AppShell/AppShell";

/** When the sidebar header content is narrower than this, hide the wordmark. */
const SIDEBAR_HEADER_WORDMARK_MIN_PX = 210;

function SidebarHeaderWordmark(props: {
  title: string;
  onTitleClick?: () => void;
  hideWordmark: boolean;
}) {
  const { title, onTitleClick, hideWordmark } = props;

  if (hideWordmark) {
    return <p className="sr-only">{title}</p>;
  }

  if (onTitleClick) {
    return (
      <button
        type="button"
        className="lightcode-overlay-header__controls shrink-0 text-xs font-semibold leading-none uppercase tracking-[0.12em] text-muted transition-colors hover:text-foreground"
        onClick={onTitleClick}
      >
        {title}
      </button>
    );
  }

  return (
    <p className="shrink-0 text-xs font-semibold leading-none uppercase tracking-[0.12em] text-muted">
      {title}
    </p>
  );
}

function SidebarHeaderRow(props: {
  title: string;
  onTitleClick?: () => void;
  children?: ReactNode;
}) {
  const { isCollapsed, closingOverlay } = useSidebar();
  const ref = useRef<HTMLDivElement>(null);
  const [hideWordmark, setHideWordmark] = useState(false);
  const showHeaderActions = !isCollapsed || closingOverlay;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      setHideWordmark(el.getBoundingClientRect().width < SIDEBAR_HEADER_WORDMARK_MIN_PX);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`flex min-h-0 min-w-0 flex-1 items-center gap-1.5${isWindows() ? " pl-1" : ""}`}
    >
      {isMac() && <div className={macosTrafficLightGutterClass} />}
      <SidebarHeaderWordmark
        title={props.title}
        {...(props.onTitleClick != null ? { onTitleClick: props.onTitleClick } : {})}
        hideWordmark={hideWordmark}
      />
      {showHeaderActions ? props.children : null}
      <div className="flex-1" />
    </div>
  );
}

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
  gitPanel?: ReactNode;
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
    gitPanel,
    onRequestClosePanels,
  } = props;

  const sidebarHeader = (
    <SidebarHeaderRow title={title} {...(onTitleClick != null ? { onTitleClick } : {})}>
      {sidebarHeaderChildren}
    </SidebarHeaderRow>
  );

  // macOS only: drop the empty center `lightcode-overlay-header` when there is no content so main
  // + the right column reclaim the titlebar row next to hidden-inset chrome. Other platforms keep
  // the empty row (signalled by the empty fragment, since `null` would suppress it everywhere).
  const contentHeader = contentHeaderChildren ?? (isMac() ? null : <></>);

  return (
    <AppShell
      sidebarHeader={sidebarHeader}
      contentHeader={contentHeader}
      sidebar={sidebar}
      content={content}
      rightPanel={rightPanel}
      gitPanel={gitPanel}
      {...(onRequestClosePanels != null ? { onRequestClosePanels } : {})}
    />
  );
}
