import { useLingui } from "@lingui/react/macro";
import { ArrowRight } from "lucide-react";

import { formatDocketValue, type ActionProposalViewModel } from "../actionProposalViewModel";
import { docketStrings } from "../approvalDocketStrings";
import { DocketSection } from "./DocketSection";

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
        <p className="max-w-prose text-small text-foreground">{proposal.requestedChangeSummary}</p>
      ) : null}

      {proposal.fieldChanges.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-small">
            <caption className="sr-only">{t(docketStrings.requestedChangeHeading)}</caption>
            <thead>
              <tr className="border-b border-divider text-tiny uppercase tracking-wide text-default-500">
                <th scope="col" className="py-1.5 pr-4 font-medium">
                  {t(docketStrings.fieldColumn)}
                </th>
                <th scope="col" className="py-1.5 pr-4 font-medium">
                  {t(docketStrings.currentColumn)}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {t(docketStrings.proposedColumn)}
                </th>
              </tr>
            </thead>
            <tbody>
              {proposal.fieldChanges.map((change) => (
                <tr key={change.field} className="border-b border-divider/60 align-top">
                  <th scope="row" className="py-2 pr-4 font-normal text-default-600">
                    {change.label ?? change.field}
                  </th>
                  <td className="py-2 pr-4 text-foreground" data-testid={`current-${change.field}`}>
                    {fmt(change.currentValue, change.unit)}
                  </td>
                  <td
                    className="py-2 font-medium text-foreground"
                    data-testid={`proposed-${change.field}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowRight aria-hidden className="size-3.5 text-default-400" />
                      {fmt(change.proposedValue, change.unit)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {proposal.beforeStateNote || proposal.proposedStateNote ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {proposal.beforeStateNote ? (
            <div className="border-l-2 border-divider pl-3">
              <dt className="text-tiny uppercase tracking-wide text-default-500">
                {t(docketStrings.beforeStateLabel)}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-small text-default-600">
                {proposal.beforeStateNote}
              </dd>
            </div>
          ) : null}
          {proposal.proposedStateNote ? (
            <div className="border-l-2 border-foreground pl-3">
              <dt className="text-tiny uppercase tracking-wide text-default-500">
                {t(docketStrings.afterStateLabel)}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-small text-foreground">
                {proposal.proposedStateNote}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </DocketSection>
  );
}
