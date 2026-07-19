import { useEffect, useRef } from "react";
import type { AgentStatus, Thread } from "@/shared/contracts";
import {
  agentWithCapabilities,
  formatEffortLabel,
} from "@/renderer/components/thread/threadDraftViewHelpers";
import { resolveModelLabel } from "@/renderer/components/providers/modelDisplay";

/**
 * Read-only "current model · effort" line pinned to the right edge of the
 * compact composer pill. The compact pill trims the whole toolbar away, so
 * without this the collapsed composer gives no hint of what will answer the
 * prompt. Inert (pointer-events: none) — tapping anywhere still expands the
 * composer, where the real controls live. Hidden by CSS while the composer is
 * expanded or has typed content (the pinned send button owns that corner).
 */
export function ComposerCompactSummary(props: {
  readonly thread: Thread;
  readonly agentStatus: AgentStatus | undefined;
}) {
  const { thread, agentStatus } = props;
  const ref = useRef<HTMLDivElement | null>(null);

  const modelLabel = agentStatus
    ? resolveModelLabel(
        agentWithCapabilities(
          agentStatus,
          thread.presentationMode ?? agentStatus.capabilities.presentationMode,
        ),
        thread.config.model,
      )
    : null;

  // Publish the rendered width on the bubble so the compact input can reserve
  // right padding for it (the placeholder would otherwise run underneath).
  // Keyed on the render gate rather than mount: agent statuses land via the
  // async refresh, so the summary div usually mounts after the first render —
  // a mount-once effect would bail on the null ref and never attach.
  useEffect(() => {
    const node = ref.current;
    const bubble = node?.parentElement?.closest(".m-compose-bubble");
    if (!node || !(bubble instanceof HTMLElement)) return;
    const observer = new ResizeObserver(() => {
      bubble.style.setProperty("--m-compose-summary-width", `${node.offsetWidth}px`);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      bubble.style.removeProperty("--m-compose-summary-width");
    };
  }, [modelLabel]);

  if (!agentStatus) return null;
  const effortLabel = thread.config.effort ? formatEffortLabel(thread.config.effort) : null;

  return (
    <div ref={ref} className="m-compose-summary" aria-hidden="true">
      <span className="m-compose-summary__item">{modelLabel}</span>
      {effortLabel ? <span className="m-compose-summary__item">{effortLabel}</span> : null}
    </div>
  );
}
