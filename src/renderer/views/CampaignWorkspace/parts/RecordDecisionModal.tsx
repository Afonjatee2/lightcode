import { useEffect, useId, useState, type ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { FieldError, Input, Label, Modal, TextArea, TextField } from "@heroui/react";
import { AlertTriangle } from "lucide-react";
import { Button, Select } from "@/renderer/components/common";
import type { CampaignContextChannelViewModel } from "@/renderer/adapters/campaignViewModels";
import type { SubmitDecisionResult } from "@/renderer/services/campaignDecisions/recordCampaignDecision";
import {
  buildRecordDecisionArgs,
  emptyDecisionFormState,
  validateDecisionForm,
  type DecisionFieldError,
  type DecisionFormSeed,
  type DecisionFormState,
  type DecisionScopeType,
} from "./decisionForm";

function Field(props: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <TextField className="space-y-1.5" isInvalid={props.error !== undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-xs font-medium text-foreground">{props.label}</Label>
        {props.hint ? <span className="text-[11px] text-muted">{props.hint}</span> : null}
      </div>
      {props.children}
      {props.error ? (
        <FieldError className="text-[11px] text-danger">{props.error}</FieldError>
      ) : null}
    </TextField>
  );
}

export interface RecordDecisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignGroupId: string;
  channels: readonly CampaignContextChannelViewModel[];
  ready: boolean;
  submit: (args: ReturnType<typeof buildRecordDecisionArgs>) => Promise<SubmitDecisionResult>;
  onRecorded: () => void;
  /** Optional pre-fill when opened from an alert the decision would explain. */
  seed?: DecisionFormSeed;
  /** Title of the originating alert, shown as context (payload carries no scope). */
  alertTitle?: string;
}

/**
 * Small, focused form for recording an operator decision through the
 * `record_campaign_decision` MCP tool. It records intent only — there is no
 * approve/apply/execute path here, and no budget or platform write.
 */
export function RecordDecisionModal(props: RecordDecisionModalProps) {
  const { t } = useLingui();
  const titleId = useId();
  const [form, setForm] = useState<DecisionFormState>(() => emptyDecisionFormState(props.seed));
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);

  // Re-seed whenever the modal (re)opens so an alert-originated open starts
  // from the right defaults and a prior attempt's errors don't linger.
  useEffect(() => {
    if (props.isOpen) {
      setForm(emptyDecisionFormState(props.seed));
      setShowErrors(false);
      setBackendError(null);
      setSubmitting(false);
    }
    // props.seed is a fresh literal per open; keying on isOpen is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isOpen]);

  const update = <K extends keyof DecisionFormState>(key: K, value: DecisionFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const validation = validateDecisionForm(form);
  const errors = validation.ok ? {} : validation.errors;

  const errorText = (code: DecisionFieldError | undefined): string | undefined => {
    switch (code) {
      case "titleRequired":
        return t`Enter what you decided.`;
      case "scopeRequired":
        return t`Choose what this applies to.`;
      case "numberInvalid":
        return t`Enter a number.`;
      case "expiryInvalid":
        return t`Enter a valid date and time.`;
      case "expiryPast":
        return t`The expiry must be in the future.`;
      default:
        return undefined;
    }
  };

  const scopeTypeOptions = [
    { id: "campaign", label: t`The whole campaign` },
    { id: "channel", label: t`A channel` },
    { id: "platform", label: t`A platform` },
  ];

  const modeOptions = [
    { id: "suppress", label: t`Suppress the alert` },
    { id: "adjust-threshold", label: t`Adjust the threshold` },
    { id: "annotate", label: t`Annotate only` },
    { id: "allow", label: t`Allow the condition` },
  ];

  const channelOptions = Array.from(
    new Map(props.channels.map((c) => [c.channelLabel, c.channelLabel])).values(),
  ).map((label) => ({ id: label, label }));

  const platformOptions = Array.from(new Set(props.channels.map((c) => c.platform))).map(
    (platform) => ({ id: platform, label: platform }),
  );

  async function handleSubmit() {
    setBackendError(null);
    if (!validation.ok) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    const args = buildRecordDecisionArgs(form, props.campaignGroupId);
    try {
      const result = await props.submit(args);
      if (result.ok) {
        props.onRecorded();
        props.onClose();
        return;
      }
      setBackendError(result.message);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal.Backdrop
      isOpen={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Modal.Container placement="center" scroll="inside" size="lg">
        <Modal.Dialog aria-labelledby={titleId} className="sm:max-w-[520px]">
          <Modal.CloseTrigger />
          <Modal.Header className="pr-12">
            <div>
              <Modal.Heading id={titleId}>
                <Trans>Record a decision</Trans>
              </Modal.Heading>
              <p className="mt-0.5 text-xs text-muted">
                <Trans>
                  Records your intent so Control Centre's monitoring can honour it. Nothing is
                  approved, and no budget or platform changes.
                </Trans>
              </p>
            </div>
          </Modal.Header>

          <Modal.Body className="space-y-4 p-4">
            {props.alertTitle ? (
              <div className="rounded-md border border-[var(--cockpit-accent-line)] bg-[var(--cockpit-accent-soft)] px-3 py-2 text-[11.5px] text-muted">
                <Trans>Explaining the alert:</Trans>{" "}
                <span className="text-foreground">{props.alertTitle}</span>
              </div>
            ) : null}

            <Field
              label={t`What did you decide?`}
              error={showErrors ? errorText(errors.title) : undefined}
            >
              <Input
                aria-label={t`Decision statement`}
                placeholder={t`e.g. Allow TikTok to run up to 30% ahead of pace`}
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </Field>

            <Field label={t`Reason (optional)`}>
              <TextArea
                aria-label={t`Reason`}
                rows={2}
                placeholder={t`Why is this the right call?`}
                value={form.reason}
                onChange={(event) => update("reason", event.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">{t`Applies to`}</Label>
                <Select
                  aria-label={t`What this decision applies to`}
                  options={scopeTypeOptions}
                  value={form.scopeType}
                  onChange={(value) => {
                    update("scopeType", value as DecisionScopeType);
                    update("scopeValue", "");
                  }}
                />
              </div>
              {form.scopeType === "channel" ? (
                <Field
                  label={t`Channel`}
                  error={showErrors ? errorText(errors.scopeValue) : undefined}
                >
                  <Select
                    aria-label={t`Channel`}
                    options={channelOptions}
                    value={form.scopeValue || null}
                    placeholder={t`Select a channel`}
                    onChange={(value) => update("scopeValue", value)}
                  />
                </Field>
              ) : form.scopeType === "platform" ? (
                <Field
                  label={t`Platform`}
                  error={showErrors ? errorText(errors.scopeValue) : undefined}
                >
                  <Select
                    aria-label={t`Platform`}
                    options={platformOptions}
                    value={form.scopeValue || null}
                    placeholder={t`Select a platform`}
                    onChange={(value) => update("scopeValue", value)}
                  />
                </Field>
              ) : (
                <div />
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">{t`Effect on monitoring`}</Label>
              <Select
                aria-label={t`Effect on monitoring`}
                options={modeOptions}
                value={form.mode}
                onChange={(value) => update("mode", value as DecisionFormState["mode"])}
              />
            </div>

            {form.mode === "adjust-threshold" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t`Tolerance %`}
                  error={showErrors ? errorText(errors.tolerancePercent) : undefined}
                >
                  <Input
                    aria-label={t`Tolerance percent`}
                    inputMode="decimal"
                    placeholder={t`e.g. 30`}
                    value={form.tolerancePercent}
                    onChange={(event) => update("tolerancePercent", event.target.value)}
                  />
                </Field>
                <Field
                  label={t`Threshold value`}
                  error={showErrors ? errorText(errors.thresholdValue) : undefined}
                >
                  <Input
                    aria-label={t`Threshold value`}
                    inputMode="decimal"
                    value={form.thresholdValue}
                    onChange={(event) => update("thresholdValue", event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            <Field
              label={t`Expires (optional)`}
              hint={t`Starts immediately`}
              error={showErrors ? errorText(errors.expiresAt) : undefined}
            >
              <Input
                aria-label={t`Expiry date and time`}
                type="datetime-local"
                value={form.expiresAtLocal}
                onChange={(event) => update("expiresAtLocal", event.target.value)}
              />
            </Field>

            {backendError ? (
              <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[11.5px] text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{backendError}</span>
              </div>
            ) : null}

            {!props.ready ? (
              <p className="text-[11.5px] text-warning">
                <Trans>Control Centre isn't connected for this project yet.</Trans>
              </p>
            ) : null}
          </Modal.Body>

          <Modal.Footer>
            <Button variant="ghost" size="sm" onPress={props.onClose} isDisabled={submitting}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              className="text-white"
              onPress={() => void handleSubmit()}
              isDisabled={submitting || !props.ready}
            >
              {submitting ? <Trans>Recording…</Trans> : <Trans>Record decision</Trans>}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
