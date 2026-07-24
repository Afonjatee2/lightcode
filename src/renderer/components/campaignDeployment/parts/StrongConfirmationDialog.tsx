import { AlertDialog, Button, Input, Label } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import { STRONG_CONFIRMATION_PHRASE } from "../actionProposalViewModel";
import { docketStrings } from "../approvalDocketStrings";

/**
 * Strong-confirmation gate for high/critical-risk approvals. The operator
 * must type the fixed phrase (STRONG_CONFIRMATION_PHRASE, deliberately not
 * localized) before the confirm button enables. The component never bypasses
 * this gate: the typed phrase is forwarded verbatim to the approve callback,
 * and the server remains the final authority on whether it is acceptable.
 */
export function StrongConfirmationDialog(props: {
  isOpen: boolean;
  proposalTitle: string;
  submitPending: boolean;
  onConfirm: (phrase: string) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [phrase, setPhrase] = useState("");

  // Reset the phrase every time the dialog is (re)opened.
  useEffect(() => {
    if (props.isOpen) setPhrase("");
  }, [props.isOpen]);

  const matches = phrase.trim() === STRONG_CONFIRMATION_PHRASE;

  return (
    <AlertDialog.Backdrop isOpen={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>{t(docketStrings.strongConfirmTitle)}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-small text-default-600">{props.proposalTitle}</p>
            <p className="mt-2 text-small text-foreground">{t(docketStrings.strongConfirmBody)}</p>
            <div className="mt-3">
              <Label htmlFor="strong-confirmation-phrase" className="text-tiny text-default-500">
                {t(docketStrings.strongConfirmInputLabel)}
              </Label>
              <Input
                id="strong-confirmation-phrase"
                className="mt-1 w-full"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                placeholder={STRONG_CONFIRMATION_PHRASE}
                autoComplete="off"
                aria-describedby="strong-confirmation-hint"
              />
              <p
                id="strong-confirmation-hint"
                className="mt-1 font-mono text-tiny text-default-400"
              >
                {STRONG_CONFIRMATION_PHRASE}
              </p>
            </div>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button
              slot="close"
              variant="ghost"
              className="text-muted"
              isDisabled={props.submitPending}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="danger"
              isDisabled={!matches || props.submitPending}
              aria-disabled={!matches || props.submitPending}
              onPress={() => props.onConfirm(phrase.trim())}
            >
              {props.submitPending ? t`Loading…` : t(docketStrings.confirmApprovalButton)}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
