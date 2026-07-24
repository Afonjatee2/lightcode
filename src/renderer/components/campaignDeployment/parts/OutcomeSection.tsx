import { Alert, Chip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";

import { formatDocketDateTime, type ActionProposalViewModel } from "../actionProposalViewModel";
import { docketStrings } from "../approvalDocketStrings";
import { DocketSection } from "./DocketSection";

function RecordRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 py-1">
      <dt className="w-36 shrink-0 text-tiny uppercase tracking-wide text-default-500">
        {props.label}
      </dt>
      <dd
        className={`min-w-0 flex-1 whitespace-pre-wrap text-small text-foreground ${props.mono ? "font-mono text-tiny" : ""}`}
      >
        {props.value}
      </dd>
    </div>
  );
}

/**
 * Sections 04/05 — expected platform effect + rollback guidance, then the
 * server-reported outcome: decision record, apply result, platform response,
 * error details, and the resulting audit reference. Renders server state
 * only; an absent applyResult means the server has not reported one.
 */
export function OutcomeSection(props: { proposal: ActionProposalViewModel }) {
  const { t } = useLingui();
  const { proposal } = props;
  const result = proposal.applyResult;
  const hasDecisionRecord =
    proposal.decidedBy || proposal.decidedAt || proposal.approvalNote || proposal.rejectionReason;

  return (
    <>
      {proposal.expectedPlatformEffect || proposal.rollbackGuidance ? (
        <DocketSection index="04" heading={t(docketStrings.effectRollbackHeading)}>
          <dl className="space-y-2">
            {proposal.expectedPlatformEffect ? (
              <RecordRow
                label={t(docketStrings.expectedEffectLabel)}
                value={proposal.expectedPlatformEffect}
              />
            ) : null}
            {proposal.rollbackGuidance ? (
              <RecordRow
                label={t(docketStrings.rollbackGuidanceLabel)}
                value={proposal.rollbackGuidance}
              />
            ) : null}
          </dl>
        </DocketSection>
      ) : null}

      {hasDecisionRecord || result ? (
        <DocketSection index="05" heading={t(docketStrings.outcomeHeading)}>
          {hasDecisionRecord ? (
            <div>
              <h3 className="text-tiny font-medium uppercase tracking-wide text-default-500">
                {t(docketStrings.decisionRecordLabel)}
              </h3>
              <dl className="mt-1 divide-y divide-divider/60">
                {proposal.decidedBy ? (
                  <RecordRow label={t(docketStrings.decidedByLabel)} value={proposal.decidedBy} />
                ) : null}
                {proposal.decidedAt ? (
                  <RecordRow
                    label={t(docketStrings.decidedAtLabel)}
                    value={formatDocketDateTime(proposal.decidedAt)}
                  />
                ) : null}
                {proposal.approvalNote ? (
                  <RecordRow
                    label={t(docketStrings.approvalNoteLabel)}
                    value={proposal.approvalNote}
                  />
                ) : null}
                {proposal.rejectionReason ? (
                  <RecordRow
                    label={t(docketStrings.rejectionReasonLabel)}
                    value={proposal.rejectionReason}
                  />
                ) : null}
              </dl>
            </div>
          ) : null}

          {result ? (
            <div className="mt-3" aria-live="polite">
              <div className="flex items-center gap-2">
                <h3 className="text-tiny font-medium uppercase tracking-wide text-default-500">
                  {t(docketStrings.applyResultLabel)}
                </h3>
                <Chip
                  size="sm"
                  variant="soft"
                  color={result.outcome === "applied" ? "success" : "danger"}
                >
                  {result.outcome === "applied" ? (
                    t(docketStrings.appliedResult)
                  ) : (
                    <Trans>Failed</Trans>
                  )}
                </Chip>
              </div>

              {result.outcome === "failed" && result.errorDetails ? (
                <Alert status="danger" className="mt-2">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{t(docketStrings.errorDetailsLabel)}</Alert.Title>
                    <Alert.Description>{result.errorDetails}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              <dl className="mt-1 divide-y divide-divider/60">
                {result.appliedAt ? (
                  <RecordRow
                    label={t(docketStrings.decidedAtLabel)}
                    value={formatDocketDateTime(result.appliedAt)}
                  />
                ) : null}
                {result.platformResponse ? (
                  <RecordRow
                    label={t(docketStrings.platformResponseLabel)}
                    value={result.platformResponse}
                    mono
                  />
                ) : null}
                {result.auditReference ? (
                  <RecordRow
                    label={t(docketStrings.auditReferenceLabel)}
                    value={result.auditReference}
                    mono
                  />
                ) : null}
              </dl>
            </div>
          ) : null}
        </DocketSection>
      ) : null}
    </>
  );
}
