import { Button } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { AlertTriangle, ArrowRight, ChevronRight, ClipboardList, Sun, X } from "lucide-react";
import type {
  MorningBrief,
  MorningBriefItem,
} from "@/renderer/campaign/morningBrief/briefGenerator";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";

function BriefItemRow(props: {
  item: MorningBriefItem;
  onOpen: (campaignGroupId: string, options?: { openApprovals?: boolean }) => void;
}) {
  const { t } = useLingui();
  const isCrit = props.item.topPriority === "P1";
  const isWarn = props.item.topPriority === "P2";
  const isApproval = props.item.kind === "waiting_for_approval";

  const iconTone = isCrit
    ? "bg-danger/15 text-danger"
    : isWarn
      ? "bg-warning/15 text-warning"
      : "bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]";

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--row-bg,transparent)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--row-hover)]"
      onClick={() => props.onOpen(props.item.campaignGroupId, { openApprovals: isApproval })}
    >
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-md ${iconTone}`}
        aria-hidden
      >
        {isApproval ? (
          <ClipboardList className="size-3.5" />
        ) : (
          <AlertTriangle className="size-3.5" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">
            {props.item.clientName} · {props.item.campaignName}
          </span>
          {props.item.topPriority ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${iconTone}`}
            >
              <span className="size-1 rounded-full bg-current" />
              {props.item.topPriority === "P1"
                ? t`Critical`
                : props.item.topPriority === "P2"
                  ? t`Warning`
                  : props.item.topPriority}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs font-semibold text-foreground">{props.item.reason}</p>
      </div>

      {isApproval ? (
        <span className="shrink-0 text-xs font-semibold text-[var(--cockpit-accent)]">
          <Trans>Review</Trans>
          <ArrowRight className="ml-0.5 inline size-3" aria-hidden />
        </span>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      )}
    </button>
  );
}

export function MorningBriefCard(props: {
  brief: MorningBrief;
  onDismiss: () => void;
  onOpenCampaign: (campaignGroupId: string, options?: { openApprovals?: boolean }) => void;
}) {
  const { t } = useLingui();
  const { brief, onDismiss, onOpenCampaign } = props;

  return (
    <section className="rounded-xl border border-[var(--hairline)] bg-surface p-4.5 space-y-3.5 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]">
            <Sun className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight text-foreground">
                <Trans>Campaign Morning Brief</Trans>
              </h2>
              <span className="font-mono text-[11px] text-muted">Control Centre</span>
            </div>
            <p className="text-xs text-muted">
              <Trans>Generated</Trans> <RelativeTime iso={brief.generatedAt} /> ·{" "}
              <Plural
                value={brief.counts.needsAttention}
                one="# thing needs attention"
                other="# things need attention"
              />{" "}
              ·{" "}
              <Plural
                value={brief.counts.waitingForApproval}
                one="# awaiting approval"
                other="# awaiting approval"
              />{" "}
              · <Trans>Health:</Trans> {brief.healthNote}
            </p>
          </div>
        </div>

        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          aria-label={t`Dismiss brief`}
          className="shrink-0 text-muted hover:text-foreground"
          onPress={onDismiss}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {brief.topNeedsAttention.map((item) => (
          <BriefItemRow key={item.id} item={item} onOpen={onOpenCampaign} />
        ))}

        {brief.topWaitingForApproval.map((item) => (
          <BriefItemRow key={item.id} item={item} onOpen={onOpenCampaign} />
        ))}
      </div>
    </section>
  );
}
