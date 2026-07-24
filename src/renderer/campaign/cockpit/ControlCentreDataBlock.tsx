import { Trans, useLingui } from "@lingui/react/macro";
import type { ConsultationContextPacketBody } from "@/shared/consultations";

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

/**
 * Monospace deterministic context snapshot — visually distinct from AI prose.
 */
export function ControlCentreDataBlock(props: {
  context: ConsultationContextPacketBody;
  capturedAt?: string | null;
}) {
  const { t } = useLingui();
  const { budget } = props.context;
  const pacingDelta =
    budget.percentUsed !== null && budget.expectedPercentUsed !== null
      ? budget.percentUsed - budget.expectedPercentUsed
      : null;
  const pacingTone =
    pacingDelta === null
      ? "text-muted"
      : pacingDelta < -5 || pacingDelta > 5
        ? "text-warning"
        : "text-success";

  return (
    <div className="cockpit-control-block max-w-[78%]">
      <div className="mb-1 flex items-center gap-2">
        <span className="cockpit-klabel text-[10px] tracking-[0.08em]">
          <Trans>CONTROL CENTRE</Trans>
        </span>
        <span className="text-[10px] text-muted">
          {props.capturedAt ? (
            <Trans>deterministic · {props.capturedAt}</Trans>
          ) : (
            <Trans>deterministic</Trans>
          )}
        </span>
      </div>
      <div className="cockpit-control-block__body font-mono text-[12.5px] leading-8 text-foreground">
        <div>
          {t`Spend`} <span className="font-semibold">{formatMoney(budget.spentToDate)}</span>{" "}
          {t`of`} <span className="font-semibold">{formatMoney(budget.totalBudget)}</span>
          {budget.percentUsed !== null ? (
            <span className="text-muted"> ({formatPct(budget.percentUsed)})</span>
          ) : null}
          {budget.percentUsed !== null ? ")" : null}
        </div>
        {budget.expectedPercentUsed !== null ? (
          <div>
            {t`Elapsed pacing target`}{" "}
            <span className="font-semibold">{formatPct(budget.expectedPercentUsed)}</span>
          </div>
        ) : null}
        {pacingDelta !== null ? (
          <div>
            {t`Pacing delta`}{" "}
            <span className={`font-semibold ${pacingTone}`}>
              {pacingDelta > 0 ? "+" : ""}
              {pacingDelta.toFixed(1)} pts
            </span>
            {budget.pacingStatus ? (
              <span className="ml-2 rounded border border-warning/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning">
                {budget.pacingStatus.replaceAll("_", " ")}
              </span>
            ) : null}
          </div>
        ) : null}
        {props.context.kpiEvidence.length > 0 ? (
          <div className="mt-1 border-t border-[var(--hairline)] pt-2">
            {props.context.kpiEvidence.slice(0, 4).map((kpi) => (
              <div key={kpi.id}>
                {kpi.metricKey}{" "}
                <span className="font-semibold">
                  {kpi.actualValue ?? "—"} / {kpi.targetValue}
                </span>
                {kpi.status ? (
                  <span className="ml-2 text-[10px] uppercase text-muted">
                    {kpi.status.replaceAll("_", " ")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
