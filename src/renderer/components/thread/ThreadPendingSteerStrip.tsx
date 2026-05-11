import { Tooltip } from "@heroui/react";
import { Loader2, Send, X } from "lucide-react";
import type { PendingSteerState } from "@/shared/contracts";
import { ThreadDockHeader, ThreadDockList, ThreadDockRow, ThreadDockSection } from "./ThreadDockUI";

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
    <ThreadDockSection placement="composer" collapsed={false}>
      <ThreadDockHeader
        icon={Send}
        title="Pending steer"
        countLabel={
          <>
            <Loader2 className="size-3 animate-spin" />
            waiting for agent to stop
          </>
        }
        actions={
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
        }
      />
      <ThreadDockList placement="composer" collapsed={false}>
        <ThreadDockRow title={preview}>
          <span className="min-w-0 flex-1 truncate text-foreground">{preview}</span>
        </ThreadDockRow>
      </ThreadDockList>
    </ThreadDockSection>
  );
}
