import { useLingui } from "@lingui/react/macro";
import { ShieldAlert } from "lucide-react";

import {
  isStrongConfirmationRequired,
  type ActionProposalViewModel,
} from "../actionProposalViewModel";
import { docketStrings } from "../approvalDocketStrings";
import { DocketSection } from "./DocketSection";

/**
 * Section 03 — risk classification: level chip (rendered in the masthead),
 * the server's high-risk reasons, and the strong-confirmation requirement.
 */
export function RiskSection(props: { proposal: ActionProposalViewModel }) {
  const { t } = useLingui();
  const { risk } = props.proposal;
  const strongRequired = isStrongConfirmationRequired(risk);

  if (risk.reasons.length === 0 && !strongRequired) {
    return null;
  }

  return (
    <DocketSection index="03" heading={t(docketStrings.riskHeading)}>
      {risk.reasons.length > 0 ? (
        <div>
          <h3 className="text-tiny font-medium uppercase tracking-wide text-default-500">
            {t(docketStrings.riskReasonsLabel)}
          </h3>
          <ul className="mt-1 space-y-1">
            {risk.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-small text-foreground">
                <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {strongRequired ? (
        <p className="mt-2 text-small font-medium text-danger">
          {t(docketStrings.strongConfirmationRequiredNote)}
        </p>
      ) : null}
    </DocketSection>
  );
}
