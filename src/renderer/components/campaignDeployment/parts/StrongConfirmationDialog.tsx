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

  useEffect(() => {
    if (props.isOpen) setPhrase("");
  }, [props.isOpen]);

  const matches = phrase.trim() === STRONG_CONFIRMATION_PHRASE;

  return (
    <AlertDialog.Backdrop isOpen={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="cockpit-docket-dialog">
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>{t(docketStrings.strongConfirmTitle)}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm text-muted">{props.proposalTitle}</p>
            <p className="mt-2 text-sm text-foreground">{t(docketStrings.strongConfirmBody)}</p>
            <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-foreground">
              <Trans>
                This action cannot be undone. Type the confirmation phrase exactly as shown.
              </Trans>
            </div>
            <div className="mt-3">
              <Label htmlFor="strong-confirmation-phrase" className="cockpit-klabel">
                {t(docketStrings.strongConfirmInputLabel)}
              </Label>
              <Input
                id="strong-confirmation-phrase"
                className="mt-1 w-full font-mono"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                placeholder={STRONG_CONFIRMATION_PHRASE}
                autoComplete="off"
                aria-describedby="strong-confirmation-hint"
              />
              <p
                id="strong-confirmation-hint"
                className="mt-1 font-mono text-xs text-[var(--cockpit-accent)]"
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
              variant="primary"
              className="bg-[var(--cockpit-accent)] text-[#0e0e14]"
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
