import { Tooltip } from "@heroui/react";
import { Loader2, Send, X } from "lucide-react";
import type { PendingSteerState } from "@/shared/contracts";

interface ThreadPendingSteerStripProps {
  pending: PendingSteerState;
  onCancel: () => void;
}

/**
 * Compact strip rendered above the composer while a steer message is staged
 * but not yet flushed (the gap between cancel-issued and cancel-acked).
 * Mirrors `ThreadTodoDock` chrome so the queue affordance feels native to
 * the composer surface.
 */
export function ThreadPendingSteerStrip(props: ThreadPendingSteerStripProps) {
  const { pending, onCancel } = props;
  const preview = pending.prompt.trim();
  return (
    <section
      aria-label="Pending steer message"
      className="flex flex-col border-b border-[color:var(--border)] bg-transparent text-xs"
      data-pending-steer-id={pending.id}
    >
      <div className="flex items-center gap-2 px-2 py-1 leading-none">
        <Send className="size-3.5 shrink-0 text-foreground-muted" />
        <div className="flex min-w-0 flex-1 items-center gap-2 leading-none">
          <span className="font-semibold text-foreground">Pending steer</span>
          <span className="flex items-center gap-1 text-[0.85em] text-[color:var(--muted)]">
            <Loader2 className="size-3 animate-spin" />
            waiting for agent to stop
          </span>
        </div>
        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <button
              aria-label="Cancel pending steer"
              className="shrink-0 rounded p-1 text-muted/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              type="button"
              onClick={onCancel}
            >
              <X className="size-3.5" />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>Cancel pending steer</Tooltip.Content>
        </Tooltip>
      </div>
      <div className="px-1 pb-1">
        <div className="flex items-center gap-2 rounded px-2 py-0.5 leading-none" title={preview}>
          <span className="min-w-0 flex-1 truncate text-foreground">{preview}</span>
        </div>
      </div>
    </section>
  );
}
