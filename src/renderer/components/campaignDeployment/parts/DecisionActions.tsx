import { Button, Label, Spinner, TextArea } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

import {
  isProposalActionable,
  isStrongConfirmationRequired,
  type ActionProposalViewModel,
} from "../actionProposalViewModel";
import { docketStrings } from "../approvalDocketStrings";
import { DocketSection } from "./DocketSection";

type PendingAction = "approve" | "reject" | null;

/**
 * Section 06 — the operator decision surface.
 *
 * Shown only while the server status is `awaiting_approval`; every other
 * status renders read-only state (e.g. the applying note). Both fields are
 * optional per the API (approval note / rejection reason). This component
 * holds only transient form state — the decision itself is always submitted
 * through the injected callbacks, and the result is rendered from the
 * server-returned `proposal` prop.
 */
export function DecisionActions(props: {
  proposal: ActionProposalViewModel;
  pendingAction: PendingAction;
  onApprove: (approvalNote: string | undefined) => void;
  onReject: (rejectionReason: string | undefined) => void;
}) {
  const { t } = useLingui();
  const { proposal } = props;

  if (!isProposalActionable(proposal.status)) {
    if (proposal.status === "applying") {
      return (
        <DocketSection index="06" heading={t(docketStrings.decisionHeading)}>
          <p
            className="flex items-center gap-2 text-small text-default-600"
            role="status"
            data-testid="applying-note"
          >
            <Spinner size="sm" aria-hidden />
            {t(docketStrings.applyingNote)}
          </p>
        </DocketSection>
      );
    }
    return null;
  }

  return (
    <DocketSection index="06" heading={t(docketStrings.decisionHeading)}>
      <DecisionForms
        key={`${proposal.id}:${proposal.status}`}
        requiresStrongConfirmation={isStrongConfirmationRequired(proposal.risk)}
        pendingAction={props.pendingAction}
        onApprove={props.onApprove}
        onReject={props.onReject}
      />
    </DocketSection>
  );
}

function DecisionForms(props: {
  requiresStrongConfirmation: boolean;
  pendingAction: PendingAction;
  onApprove: (approvalNote: string | undefined) => void;
  onReject: (rejectionReason: string | undefined) => void;
}) {
  const { t } = useLingui();
  const [approvalNote, setApprovalNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectFormOpen, setRejectFormOpen] = useState(false);

  const busy = props.pendingAction !== null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="border border-divider p-3">
        <Label
          htmlFor="approval-note"
          className="text-tiny uppercase tracking-wide text-default-500"
        >
          {t(docketStrings.approvalNoteLabel)} ({t`Optional`})
        </Label>
        <TextArea
          id="approval-note"
          className="mt-1 w-full"
          rows={3}
          value={approvalNote}
          onChange={(event) => setApprovalNote(event.target.value)}
          placeholder={t(docketStrings.approvalNotePlaceholder)}
          disabled={busy}
        />
        <Button
          variant="primary"
          className="mt-2"
          isDisabled={busy}
          aria-busy={props.pendingAction === "approve"}
          onPress={() => props.onApprove(approvalNote.trim() || undefined)}
        >
          {props.pendingAction === "approve" ? <Spinner size="sm" aria-hidden /> : null}
          {props.requiresStrongConfirmation ? t(docketStrings.approveHighRiskButton) : t`Approve`}
        </Button>
      </div>

      <div className="border border-divider p-3">
        {rejectFormOpen ? (
          <>
            <Label
              htmlFor="rejection-reason"
              className="text-tiny uppercase tracking-wide text-default-500"
            >
              {t(docketStrings.rejectionReasonLabel)} ({t`Optional`})
            </Label>
            <TextArea
              id="rejection-reason"
              className="mt-1 w-full"
              rows={3}
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder={t(docketStrings.rejectionReasonPlaceholder)}
              disabled={busy}
            />
            <div className="mt-2 flex gap-2">
              <Button
                variant="danger"
                isDisabled={busy}
                aria-busy={props.pendingAction === "reject"}
                onPress={() => props.onReject(rejectionReason.trim() || undefined)}
              >
                {props.pendingAction === "reject" ? <Spinner size="sm" aria-hidden /> : null}
                {t(docketStrings.rejectButton)}
              </Button>
              <Button variant="ghost" isDisabled={busy} onPress={() => setRejectFormOpen(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col justify-between gap-2">
            <p className="text-tiny uppercase tracking-wide text-default-500">
              {t(docketStrings.rejectionReasonLabel)}
            </p>
            <Button
              variant="tertiary"
              className="self-start text-danger"
              isDisabled={busy}
              onPress={() => setRejectFormOpen(true)}
            >
              {t(docketStrings.rejectButton)}…
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
