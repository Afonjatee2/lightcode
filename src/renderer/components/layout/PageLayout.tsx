import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button, Tooltip } from "@heroui/react";
import { House } from "lucide-react";
import { isMac, isWindows } from "@/renderer/bridge";
import { macosTrafficLightGutterClass } from "@/renderer/components/layout/sidebarChrome";
import {
  AppShell,
  SidebarContext,
  useSidebar,
} from "@/renderer/views/MainView/parts/AppShell/AppShell";

const alwaysExpandedSidebar = {
  isCollapsed: false,
  isOverlay: false,
  closingOverlay: false,
  collapse: () => {},
  expand: () => {},
};

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
  const fullContentRef = useRef<HTMLDivElement>(null);
  const [hideWordmark, setHideWordmark] = useState(false);
  const showHeaderActions = !isCollapsed || closingOverlay;

  useLayoutEffect(() => {
    // Only macOS reserves space for left-side window controls (traffic lights),
    // so the wordmark only needs to collapse there. Other platforms have full width.
    if (!isMac()) return;

    const el = ref.current;
    const fullContentEl = fullContentRef.current;
    if (!el || !fullContentEl) return;

    const update = () => {
      // Switch to icon-only mode if the available width is less than the required width
      setHideWordmark(el.clientWidth < fullContentEl.scrollWidth);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    const ro2 = new ResizeObserver(() => update());
    ro2.observe(fullContentEl);

    return () => {
      ro.disconnect();
      ro2.disconnect();
    };
  }, [props.title]);

  return (
    <>
      {/* Ghost container to measure uncollapsed width */}
      <div
        ref={fullContentRef}
        className={`pointer-events-none absolute left-0 top-0 flex w-max items-center gap-1.5 opacity-0${
          isWindows() ? " pl-1" : ""
        }`}
        aria-hidden="true"
      >
        {isMac() && <div className={macosTrafficLightGutterClass} />}
        {showHeaderActions && <SidebarHeaderWordmark title={props.title} hideWordmark={false} />}
        {showHeaderActions ? props.children : null}
      </div>

      <div
        ref={ref}
        className={`flex min-h-0 min-w-0 flex-1 items-center gap-1.5${isWindows() ? " pl-1" : ""}`}
      >
        {isMac() && <div className={macosTrafficLightGutterClass} />}
        {showHeaderActions ? (
          hideWordmark && props.onTitleClick ? (
            <Tooltip delay={150}>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={props.title}
                  className="lightcode-overlay-header__controls size-6 min-w-0 shrink-0 text-muted hover:text-foreground"
                  onPress={props.onTitleClick}
                >
                  <House className="size-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">{props.title}</Tooltip.Content>
            </Tooltip>
          ) : (
            <SidebarHeaderWordmark
              title={props.title}
              {...(props.onTitleClick != null ? { onTitleClick: props.onTitleClick } : {})}
              hideWordmark={hideWordmark}
            />
          )
        ) : null}
        {showHeaderActions ? props.children : null}
        <div className="flex-1" />
      </div>
    </>
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
  forceSidebarExpanded?: boolean;
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
    forceSidebarExpanded,
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

  const shell = (
    <AppShell
      sidebarHeader={sidebarHeader}
      contentHeader={contentHeader}
      sidebar={sidebar}
      content={content}
      rightPanel={rightPanel}
      gitPanel={gitPanel}
      {...(forceSidebarExpanded === true ? { forceSidebarExpanded: true } : {})}
      {...(onRequestClosePanels != null ? { onRequestClosePanels } : {})}
    />
  );

  if (forceSidebarExpanded === true) {
    return <SidebarContext.Provider value={alwaysExpandedSidebar}>{shell}</SidebarContext.Provider>;
  }

  return shell;
}
