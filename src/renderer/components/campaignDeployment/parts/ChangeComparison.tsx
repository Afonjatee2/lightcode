import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowRight } from "lucide-react";

import { formatDocketValue, type ActionProposalViewModel } from "../actionProposalViewModel";
import { docketStrings } from "../approvalDocketStrings";
import { DocketSection } from "./DocketSection";
import { deriveFieldChangeDelta } from "./fieldChangeDelta";

/**
 * Section 01 — the requested change: narrative summary, the field-level
 * current → proposed comparison table, and the raw before/after state notes.
 * All values are server-computed; nothing is derived here beyond formatting.
 */
export function ChangeComparison(props: { proposal: ActionProposalViewModel }) {
  const { t } = useLingui();
  const { proposal } = props;

  const fmt = (value: Parameters<typeof formatDocketValue>[0], unit?: string) =>
    formatDocketValue(value, {
      yesLabel: t(docketStrings.yes),
      noLabel: t(docketStrings.no),
      ...(unit !== undefined ? { unit } : {}),
    });

  return (
    <DocketSection index="01" heading={t(docketStrings.requestedChangeHeading)}>
      {proposal.requestedChangeSummary ? (
        <p className="max-w-prose text-sm text-foreground">{proposal.requestedChangeSummary}</p>
      ) : null}

      {proposal.fieldChanges.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--hairline)]">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t(docketStrings.requestedChangeHeading)}</caption>
            <thead>
              <tr className="border-b border-[var(--hairline)] bg-surface-secondary text-[10.5px] uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2 font-bold">
                  {t(docketStrings.fieldColumn)}
                </th>
                <th scope="col" className="px-3 py-2 font-bold">
                  {t(docketStrings.currentColumn)}
                </th>
                <th scope="col" className="px-3 py-2 font-bold">
                  {t(docketStrings.proposedColumn)}
                </th>
                <th scope="col" className="px-3 py-2 font-bold">
                  <Trans>Delta</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {proposal.fieldChanges.map((change) => {
                const delta = deriveFieldChangeDelta(change);
                const deltaClass =
                  delta?.direction === "up"
                    ? "bg-warning/15 text-warning"
                    : delta?.direction === "down"
                      ? "bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]"
                      : "bg-[var(--row-hover)] text-muted";

                return (
                  <tr
                    key={change.field}
                    className="border-b border-[var(--hairline)] align-middle last:border-0"
                  >
                    <th scope="row" className="px-3 py-2.5 font-medium text-muted">
                      {change.label ?? change.field}
                    </th>
                    <td
                      className="px-3 py-2.5 tabular-nums text-muted"
                      data-testid={`current-${change.field}`}
                    >
                      {fmt(change.currentValue, change.unit)}
                    </td>
                    <td
                      className="px-3 py-2.5 font-bold tabular-nums text-warning"
                      data-testid={`proposed-${change.field}`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <ArrowRight aria-hidden className="size-3.5 text-muted" />
                        {fmt(change.proposedValue, change.unit)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {delta ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${deltaClass}`}
                        >
                          {delta.label}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {proposal.beforeStateNote || proposal.proposedStateNote ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {proposal.beforeStateNote ? (
            <div className="border-l-2 border-[var(--hairline)] pl-3">
              <dt className="cockpit-klabel">{t(docketStrings.beforeStateLabel)}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-muted">
                {proposal.beforeStateNote}
              </dd>
            </div>
          ) : null}
          {proposal.proposedStateNote ? (
            <div className="border-l-2 border-[var(--cockpit-accent)] pl-3">
              <dt className="cockpit-klabel">{t(docketStrings.afterStateLabel)}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {proposal.proposedStateNote}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </DocketSection>
  );
}
