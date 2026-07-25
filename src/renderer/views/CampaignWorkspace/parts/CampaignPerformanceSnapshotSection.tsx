import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Chip } from "@heroui/react";
import type {
  PerformanceSnapshot,
  PerformanceSnapshotChannel,
  PerformanceSnapshotChannelStatus,
  PerformanceSnapshotKpi,
} from "@/shared/contracts/campaign/performanceSnapshot";

function formatMoney(value: number | undefined, locale: string): string {
  if (value === undefined) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return value.toLocaleString(locale);
  }
}

function formatCount(value: number | undefined, locale: string): string {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function snapshotStatusChipColor(
  status: PerformanceSnapshotChannelStatus | undefined,
): "success" | "warning" | "default" {
  if (status === "on_track") return "success";
  if (status === "at_risk") return "warning";
  return "default";
}

function snapshotStatusLabel(status: PerformanceSnapshotChannelStatus | undefined): ReactNode {
  if (status === "on_track") return <Trans>On track</Trans>;
  if (status === "at_risk") return <Trans>At risk</Trans>;
  if (status === "no_data") return <Trans>No data</Trans>;
  return <Trans>Unknown</Trans>;
}

function SnapshotChannelRow(props: { channel: PerformanceSnapshotChannel; locale: string }) {
  const { t } = useLingui();
  const { channel, locale } = props;
  const status = channel.status;

  return (
    <li className="border-t border-[var(--hairline)] pt-2 first:border-0 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="w-[74px] shrink-0 text-xs font-semibold text-foreground">
          {channel.channel}
        </span>
        {status ? (
          <Chip size="sm" variant="soft" color={snapshotStatusChipColor(status)}>
            {snapshotStatusLabel(status)}
          </Chip>
        ) : null}
      </div>
      <p className="mt-1 text-[10.5px] tabular-nums text-muted">
        {formatMoney(channel.spend, locale)} / {formatMoney(channel.budget, locale)}
      </p>
      {channel.impressions !== undefined || channel.impressionsTarget !== undefined ? (
        <p className="text-[10.5px] tabular-nums text-muted">
          {t`Impressions ${formatCount(channel.impressions, locale)} / ${formatCount(channel.impressionsTarget, locale)}`}
        </p>
      ) : null}
    </li>
  );
}

function SnapshotKpiRow(props: { kpi: PerformanceSnapshotKpi; locale: string }) {
  const { kpi, locale } = props;
  const pct = kpi.pctAchieved;
  const onTrack = kpi.status === "on_track";

  return (
    <li className="border-t border-[var(--hairline)] pt-2 first:border-0 first:pt-0">
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-semibold text-foreground">{kpi.label}</span>
        <span className={`tabular-nums font-semibold ${onTrack ? "text-success" : "text-warning"}`}>
          {pct !== undefined ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <p className="text-[10.5px] tabular-nums text-muted">
        {formatCount(kpi.actual, locale)} / {formatCount(kpi.target, locale)}
      </p>
    </li>
  );
}

export function CampaignPerformanceSnapshotSection(props: { snapshot: PerformanceSnapshot }) {
  const { i18n, t } = useLingui();
  const generatedLabel = (() => {
    try {
      const time = new Date(props.snapshot.generatedAt).toLocaleTimeString(i18n.locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
      return t`from chat · ${time}`;
    } catch {
      return t`from chat`;
    }
  })();

  return (
    <section className="mb-2.5 overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-surface-secondary">
      <header className="border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="cockpit-klabel !text-[11px] !tracking-[0.07em]">
            <Trans>Latest performance</Trans>
          </h3>
          <span className="text-[10px] text-muted">{generatedLabel}</span>
        </div>
        {props.snapshot.headline ? (
          <p className="mt-1 text-xs font-semibold text-foreground">{props.snapshot.headline}</p>
        ) : null}
      </header>

      <div className="space-y-3 px-3 py-3">
        {props.snapshot.channels.length > 0 ? (
          <div>
            <p className="cockpit-klabel mb-1.5 text-[10px] tracking-wider text-muted uppercase">
              <Trans>Channels</Trans>
            </p>
            <ul className="space-y-2">
              {props.snapshot.channels.map((channel) => (
                <SnapshotChannelRow key={channel.channel} channel={channel} locale={i18n.locale} />
              ))}
            </ul>
          </div>
        ) : null}

        {props.snapshot.kpis && props.snapshot.kpis.length > 0 ? (
          <div>
            <p className="cockpit-klabel mb-1.5 text-[10px] tracking-wider text-muted uppercase">
              <Trans>KPIs</Trans>
            </p>
            <ul className="space-y-2">
              {props.snapshot.kpis.map((kpi) => (
                <SnapshotKpiRow key={kpi.label} kpi={kpi} locale={i18n.locale} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
