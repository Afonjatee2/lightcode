import { useState } from "react";
import { Tooltip } from "@heroui/react";
import { AlertTriangle, ChevronDown, X } from "lucide-react";
import type { ThreadErrorDockState } from "./threadErrorState";
import { ThreadDockHeader, ThreadDockSection } from "./ThreadDockUI";

interface ThreadErrorDockProps {
  state: ThreadErrorDockState;
  onDismiss?: () => void;
}

export function ThreadErrorDock(props: ThreadErrorDockProps) {
  const { state, onDismiss } = props;
  const [collapsed, setCollapsed] = useState(true);
  const isMultiline = state.message.includes("\n") || state.message.length > 120;
  const canExpand = isMultiline;
  const { title, body } = splitErrorTitle(state.message);

  return (
    <ThreadDockSection placement="composer" collapsed={collapsed}>
      <ThreadDockHeader
        icon={AlertTriangle}
        iconClassName="text-danger"
        title={title}
        actions={
          <>
            {canExpand ? (
              <Tooltip delay={0}>
                <Tooltip.Trigger>
                  <button
                    aria-label={collapsed ? "Expand error" : "Collapse error"}
                    className="shrink-0 rounded p-1 text-muted/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                    type="button"
                    onClick={() => setCollapsed(!collapsed)}
                  >
                    <ChevronDown
                      className={`size-3.5 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`}
                    />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content>{collapsed ? "Expand" : "Collapse"}</Tooltip.Content>
              </Tooltip>
            ) : null}
            {onDismiss ? (
              <Tooltip delay={0}>
                <Tooltip.Trigger>
                  <button
                    aria-label="Dismiss error"
                    className="shrink-0 rounded p-1 text-muted/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                    type="button"
                    onClick={onDismiss}
                  >
                    <X className="size-3.5" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content>Dismiss</Tooltip.Content>
              </Tooltip>
            ) : null}
          </>
        }
      >
        <span className="min-w-0 flex-1 truncate text-[color:var(--muted)]" title={state.message}>
          {body}
        </span>
      </ThreadDockHeader>

      {canExpand && !collapsed ? (
        <div className="max-h-[min(12rem,32vh)] overflow-y-auto whitespace-pre-wrap break-words px-2 pb-1.5 text-[color:var(--muted)] [scrollbar-gutter:stable]">
          {state.message}
        </div>
      ) : null}
    </ThreadDockSection>
  );
}

function firstLine(message: string): string {
  const newlineIndex = message.indexOf("\n");
  return newlineIndex >= 0 ? message.slice(0, newlineIndex) : message;
}

// If the first line is shaped like "<short category>: <details>", surface the
// category as the dock title (e.g. "Invalid request", "Network error", "Auth
// failed") instead of the generic "Error". Falls back to "Error" when the
// message has no useful prefix.
function splitErrorTitle(message: string): { title: string; body: string } {
  const head = firstLine(message).trim();
  const match = /^([A-Z][^:\n]{1,48}):\s+(\S.*)$/.exec(head);
  if (match) {
    return { title: match[1]!, body: match[2]! };
  }
  return { title: "Error", body: head };
}
