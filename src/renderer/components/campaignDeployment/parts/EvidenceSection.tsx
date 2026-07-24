import { Chip, Disclosure } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";

import { formatDocketDateTime, type ActionProposalViewModel } from "../actionProposalViewModel";
import { docketStrings, evidenceKindStrings } from "../approvalDocketStrings";
import { DocketSection } from "./DocketSection";

/**
 * Section 02 — deterministic evidence backing the proposal: cited evidence
 * items, the sources the packet drew from, calculation details (collapsible),
 * and provenance. Values render verbatim from the server-normalized model —
 * the docket never recomputes them.
 */
export function EvidenceSection(props: { proposal: ActionProposalViewModel }) {
  const { t } = useLingui();
  const { evidence } = props.proposal;
  const isEmpty =
    evidence.items.length === 0 &&
    evidence.sources.length === 0 &&
    evidence.calculations.length === 0;

  return (
    <DocketSection
      index="02"
      heading={t(docketStrings.evidenceHeading)}
      aside={
        <span className="font-mono text-tiny text-default-400">
          {t(docketStrings.evidencePacketLabel)} · {evidence.packetId}
        </span>
      }
    >
      {isEmpty ? (
        <p className="text-small text-default-400">{t(docketStrings.evidenceEmpty)}</p>
      ) : (
        <div className="space-y-4">
          {evidence.items.length > 0 ? (
            <ul className="divide-y divide-divider/60">
              {evidence.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <Chip size="sm" variant="tertiary" className="shrink-0">
                    {t(evidenceKindStrings[item.kind] ?? { message: item.kind })}
                  </Chip>
                  <span className="min-w-0 flex-1 text-small text-foreground">
                    {item.label}
                    {item.value ? (
                      <span className="block text-tiny text-default-600">{item.value}</span>
                    ) : null}
                  </span>
                  {item.reference ? (
                    <span className="font-mono text-tiny text-default-400">{item.reference}</span>
                  ) : null}
                  {item.observedAt ? (
                    <span className="text-tiny text-default-400">
                      {formatDocketDateTime(item.observedAt)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {evidence.sources.length > 0 ? (
            <div>
              <h3 className="text-tiny font-medium uppercase tracking-wide text-default-500">
                <Trans>Sources</Trans>
              </h3>
              <ul className="mt-1 space-y-1">
                {evidence.sources.map((source) => (
                  <li key={source.id} className="flex flex-wrap items-baseline gap-x-2 text-small">
                    <span className="text-foreground">{source.label}</span>
                    <span className="font-mono text-tiny text-default-400">{source.reference}</span>
                    {source.freshness ? (
                      <span className="text-tiny text-default-400">{source.freshness}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {evidence.calculations.length > 0 ? (
            <Disclosure className="border border-divider">
              <Disclosure.Heading>
                <Disclosure.Trigger className="flex w-full items-center justify-between px-3 py-2 text-left text-small font-medium text-foreground">
                  {t(docketStrings.calculationsDisclosure)}
                  <Disclosure.Indicator />
                </Disclosure.Trigger>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body className="px-3 pb-3">
                  <ul className="space-y-2">
                    {evidence.calculations.map((calc) => (
                      <li key={calc.id} className="text-small">
                        <p className="text-foreground">{calc.label}</p>
                        <p className="font-mono text-tiny text-default-500">
                          {calc.expression} = <span className="text-foreground">{calc.result}</span>
                        </p>
                        {calc.inputs && calc.inputs.length > 0 ? (
                          <ul className="mt-0.5 flex flex-wrap gap-x-3">
                            {calc.inputs.map((input) => (
                              <li key={input.name} className="font-mono text-tiny text-default-400">
                                {input.name}={input.value}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          ) : null}

          {evidence.provenance || evidence.generatedAt || evidence.question ? (
            <footer className="border-t border-divider/60 pt-2 text-tiny text-default-400">
              {evidence.question ? <p>{evidence.question}</p> : null}
              <p>
                {evidence.provenance ? <span>{evidence.provenance}</span> : null}
                {evidence.generatedAt ? (
                  <span>
                    {evidence.provenance ? " · " : ""}
                    {t(docketStrings.generatedLabel)} {formatDocketDateTime(evidence.generatedAt)}
                  </span>
                ) : null}
              </p>
            </footer>
          ) : null}
        </div>
      )}
    </DocketSection>
  );
}
