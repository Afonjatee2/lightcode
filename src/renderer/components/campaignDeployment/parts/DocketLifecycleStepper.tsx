import { useLingui } from "@lingui/react/macro";
import { Check } from "lucide-react";
import type { ProposalStatus } from "../actionProposalViewModel";
import { docketStrings } from "../approvalDocketStrings";

const LIFECYCLE_STEPS = ["draft", "awaiting_approval", "approved", "applying", "applied"] as const;

type LifecycleStep = (typeof LIFECYCLE_STEPS)[number];

const STEP_LABEL: Record<LifecycleStep, (typeof docketStrings)["lifecycleDraft"]> = {
  draft: docketStrings.lifecycleDraft,
  awaiting_approval: docketStrings.lifecycleAwaiting,
  approved: docketStrings.lifecycleApproved,
  applying: docketStrings.lifecycleApplying,
  applied: docketStrings.lifecycleApplied,
};

function resolveStepIndex(status: ProposalStatus): number {
  if (status === "rejected" || status === "cancelled" || status === "failed") {
    return LIFECYCLE_STEPS.indexOf("awaiting_approval");
  }
  const direct = LIFECYCLE_STEPS.indexOf(status as LifecycleStep);
  if (direct >= 0) return direct;
  if (status === "awaiting_approval") return 1;
  return 0;
}

export function DocketLifecycleStepper(props: { status: ProposalStatus }) {
  const { t } = useLingui();
  const currentIndex = resolveStepIndex(props.status);

  return (
    <div
      className="cockpit-docket-stepper flex items-center gap-0 overflow-x-auto rounded-xl border border-[var(--hairline)] bg-surface px-4 py-3"
      data-testid="docket-lifecycle-stepper"
      role="list"
      aria-label={t(docketStrings.lifecycleHeading)}
    >
      {LIFECYCLE_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        const label = t(STEP_LABEL[step]);
        return (
          <div key={step} className="flex items-center" role="listitem">
            <div
              className={`flex items-center gap-2 whitespace-nowrap text-xs ${
                done
                  ? "text-foreground/80"
                  : current
                    ? "font-semibold text-foreground"
                    : "text-muted"
              }`}
            >
              <span
                className={`flex size-[22px] items-center justify-center rounded-full border text-[10px] font-bold ${
                  done
                    ? "border-success bg-success/15 text-success"
                    : current
                      ? "border-[var(--cockpit-accent)] bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)] shadow-[0_0_0_4px_var(--cockpit-accent-ring)]"
                      : "border-[var(--hairline-strong)] text-muted"
                }`}
              >
                {done ? <Check className="size-3" aria-hidden /> : index + 1}
              </span>
              {label}
            </div>
            {index < LIFECYCLE_STEPS.length - 1 ? (
              <span className="mx-2.5 h-px w-8 shrink-0 bg-[var(--hairline-strong)]" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
