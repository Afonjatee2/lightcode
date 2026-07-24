import { Trans, useLingui } from "@lingui/react/macro";
import type { CampaignContextViewModel } from "@/renderer/adapters/campaignViewModels";

function formatMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`.trim();
  }
}

function PacingDonut(props: { percent: number | null; label: string }) {
  const pct = props.percent === null ? 0 : Math.min(100, Math.max(0, props.percent));
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative size-16 shrink-0" aria-hidden>
      <svg className="size-16 -rotate-90" viewBox="0 0 64 64">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--cockpit-accent)"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {props.percent === null ? "—" : `${Math.round(props.percent)}%`}
        </span>
        <span className="text-[8.5px] text-muted">{props.label}</span>
      </div>
    </div>
  );
}

function PaceBar(props: { label: string; value: number | null; tone?: "default" | "warn" }) {
  const pct = props.value === null ? 0 : Math.min(100, Math.max(0, props.value));
  const fill = props.tone === "warn" ? "bg-warning" : "bg-[var(--cockpit-accent)]";

  return (
    <div className="flex-1">
      <div className="mb-1 flex justify-between text-[10px] text-muted">
        <span>{props.label}</span>
        <span className="tabular-nums text-foreground">
          {props.value === null ? "—" : `${Math.round(props.value)}%`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hairline-strong)]">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CampaignContextStatusStrip(props: { context: CampaignContextViewModel }) {
  const { t } = useLingui();
  const { budget, pacing } = props.context;
  const pacingOk = pacing.status === "on_track" || pacing.status === "unknown";
  const elapsedPct =
    props.context.dates.startDate && props.context.dates.endDate
      ? computeElapsedPercent(props.context.dates.startDate, props.context.dates.endDate)
      : null;
  const spendWarn =
    budget.pctUsed !== null && elapsedPct !== null && budget.pctUsed < elapsedPct - 5;

  return (
    <div className={`cockpit-status-strip mb-3.5 ${pacingOk ? "cockpit-status-strip--ok" : ""}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="cockpit-klabel">
            <Trans>Pacing</Trans>
          </p>
          <p className="mt-1 text-sm font-semibold capitalize text-foreground">
            {pacing.status.replaceAll("_", " ")}
          </p>
        </div>
        <PacingDonut percent={budget.pctUsed} label={t`spent`} />
      </div>
      <div className="grid gap-2 text-xs text-muted">
        <div className="flex justify-between tabular-nums">
          <span>
            <Trans>Spend</Trans>
          </span>
          <span className="font-semibold text-foreground">
            {formatMoney(budget.spentToDate, budget.currency)} /{" "}
            {formatMoney(budget.totalBudget, budget.currency)}
          </span>
        </div>
        {typeof pacing.variancePct === "number" ? (
          <div className="flex justify-between tabular-nums">
            <span>
              <Trans>Variance</Trans>
            </span>
            <span
              className={spendWarn ? "font-semibold text-warning" : "font-semibold text-foreground"}
            >
              {pacing.variancePct > 0 ? "+" : ""}
              {pacing.variancePct}%
            </span>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <PaceBar
          label={t`Budget used`}
          value={budget.pctUsed}
          tone={spendWarn ? "warn" : "default"}
        />
        <PaceBar label={t`Time elapsed`} value={elapsedPct} />
      </div>
    </div>
  );
}

function computeElapsedPercent(startDate: string, endDate: string): number | null {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const elapsed = Math.min(Math.max(now, start), end);
  return ((elapsed - start) / (end - start)) * 100;
}
