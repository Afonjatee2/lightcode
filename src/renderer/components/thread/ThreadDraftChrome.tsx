import type { RefCallback } from "react";
import { TerminalSquare, X } from "lucide-react";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import { ProjectSwitchMenu } from "./ProjectSwitchMenu";

export type ThreadDraftDropIndicator =
  | false
  | "replace"
  | "insert-left"
  | "insert-right"
  | "insert-top"
  | "insert-bottom";

export function ThreadDraftCompactHeader(props: {
  alignClass: string;
  dragHandleRef?: RefCallback<Element> | undefined;
  headerNeedsTrafficLightPad: boolean;
  onClose?: (() => void) | undefined;
  projectId: string;
  paneId?: string | undefined;
  showCloseButton?: boolean | undefined;
}) {
  return (
    <div className={`px-2 ${props.headerNeedsTrafficLightPad ? macosTrafficLightPadClass : ""}`}>
      <div
        ref={props.dragHandleRef}
        className={`${props.dragHandleRef ? "lightcode-content-over-drag-region cursor-grab active:cursor-grabbing" : "lightcode-content-over-drag-region--drag"} ${props.alignClass} flex w-full max-w-[920px] items-center gap-2 py-1`}
      >
        <TerminalSquare className="size-3.5 shrink-0 text-muted/60" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight text-muted">
          New thread
        </span>
        <div className="flex shrink-0 items-center">
          <ProjectSwitchMenu
            currentProjectId={props.projectId}
            variant="compact"
            {...(props.paneId ? { paneId: props.paneId } : {})}
          />
          {props.showCloseButton && props.onClose && (
            <button
              type="button"
              aria-label="Close pane"
              className="lightcode-overlay-header__controls shrink-0 rounded p-1 text-muted/60 transition-colors hover:bg-white/[0.06] hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                props.onClose?.();
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThreadDraftDropIndicators(props: {
  dropIndicator?: ThreadDraftDropIndicator | undefined;
}) {
  return (
    <>
      {props.dropIndicator === "replace" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-accent/10 ring-1 ring-inset ring-accent/30"
        />
      )}
      {props.dropIndicator === "insert-left" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-0.5 rounded-full bg-accent"
        />
      )}
      {props.dropIndicator === "insert-right" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 bottom-0 z-20 w-0.5 rounded-full bg-accent"
        />
      )}
      {props.dropIndicator === "insert-top" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 left-0 z-20 h-0.5 rounded-full bg-accent"
        />
      )}
      {props.dropIndicator === "insert-bottom" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-0.5 rounded-full bg-accent"
        />
      )}
    </>
  );
}

export function ThreadDraftHero(props: {
  compact?: boolean | undefined;
  projectId: string;
  paneId?: string | undefined;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="w-full max-w-[920px] overflow-visible pb-3 text-center">
        <h1
          className={`inline-flex items-baseline gap-3 overflow-visible pb-[0.12em] leading-[1.28] font-semibold tracking-normal ${props.compact ? "text-[clamp(1.375rem,2.75vw,1.875rem)]" : "text-[clamp(1.875rem,4.25vw,3.125rem)]"}`}
        >
          <span className="inline-block pr-[0.04em] pb-[0.12em] text-transparent [background-image:linear-gradient(135deg,var(--foreground)_0%,color-mix(in_oklab,var(--accent)_60%,var(--foreground))_52%,var(--muted)_100%)] [background-size:100%_100%] bg-clip-text">
            Lightcode
          </span>
          <TerminalSquare className="translate-y-[-0.04em] size-[0.48em] shrink-0 text-[color:color-mix(in_oklab,var(--accent)_58%,var(--foreground))] opacity-90" />
        </h1>
        <div
          className={`mt-1.5 flex justify-center ${props.compact ? "text-[clamp(0.6875rem,1.05vw,0.8125rem)]" : "text-[clamp(0.75rem,1.35vw,0.9375rem)]"}`}
        >
          <ProjectSwitchMenu
            currentProjectId={props.projectId}
            variant="hero"
            {...(props.paneId ? { paneId: props.paneId } : {})}
          />
        </div>
      </div>
    </div>
  );
}
