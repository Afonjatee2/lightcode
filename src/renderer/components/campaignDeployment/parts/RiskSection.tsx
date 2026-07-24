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
      <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <ShieldAlert className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          {risk.reasons.length > 0 ? (
            <div>
              <h3 className="cockpit-klabel">{t(docketStrings.riskReasonsLabel)}</h3>
              <ul className="mt-2 space-y-1.5">
                {risk.reasons.map((reason) => (
                  <li key={reason} className="text-sm text-foreground">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {strongRequired ? (
            <p className="mt-2 text-sm font-medium text-warning">
              {t(docketStrings.strongConfirmationRequiredNote)}
            </p>
          ) : null}
        </div>
      </div>
    </DocketSection>
  );
}
