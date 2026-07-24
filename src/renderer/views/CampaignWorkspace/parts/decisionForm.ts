import type {
  ControlCentreDecisionEffect,
  ControlCentreDecisionEffectMode,
  ControlCentreDecisionScope,
  RecordCampaignDecisionArgs,
} from "@/shared/contracts/campaign/controlCentreCampaignDecision";

/**
 * Pure form model + validation + argument builder for the record-decision
 * modal. Kept macro-free and side-effect-free so it can be unit-tested in a
 * node environment and reused by the component's render boundary for
 * localization.
 *
 * The form captures exactly what the `record_campaign_decision` tool contract
 * accepts: `title` (the decision statement, required), an optional `reason`, a
 * `scope` (whole campaign / a channel / a platform), the REQUIRED `effect`
 * (mode + optional threshold tuning), and the caller half of the validity
 * window (`expiresAt`). There is no `startsAt` input — the server stamps the
 * start on insert.
 */

export type DecisionScopeType = "campaign" | "channel" | "platform";

export interface DecisionFormState {
  title: string;
  reason: string;
  mode: ControlCentreDecisionEffectMode;
  tolerancePercent: string;
  thresholdValue: string;
  scopeType: DecisionScopeType;
  scopeValue: string;
  /** `<input type="datetime-local">` value, or "" for an open-ended decision. */
  expiresAtLocal: string;
}

export interface DecisionFormSeed {
  mode?: ControlCentreDecisionEffectMode;
  scopeType?: DecisionScopeType;
  scopeValue?: string;
}

export function emptyDecisionFormState(seed?: DecisionFormSeed): DecisionFormState {
  return {
    title: "",
    reason: "",
    mode: seed?.mode ?? "annotate",
    tolerancePercent: "",
    thresholdValue: "",
    scopeType: seed?.scopeType ?? "campaign",
    scopeValue: seed?.scopeValue ?? "",
    expiresAtLocal: "",
  };
}

export type DecisionFieldError =
  | "titleRequired"
  | "scopeRequired"
  | "numberInvalid"
  | "expiryInvalid"
  | "expiryPast";

export interface DecisionFormErrors {
  title?: DecisionFieldError;
  scopeValue?: DecisionFieldError;
  tolerancePercent?: DecisionFieldError;
  thresholdValue?: DecisionFieldError;
  expiresAt?: DecisionFieldError;
}

export type DecisionFormValidation = { ok: true } | { ok: false; errors: DecisionFormErrors };

/** Parses an optional numeric text field. Returns undefined when blank. */
function parseOptionalNumber(raw: string): { present: boolean; value?: number } {
  const trimmed = raw.trim();
  if (trimmed === "") return { present: false };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { present: true };
  return { present: true, value };
}

/** Converts a `datetime-local` value to an ISO instant, or undefined if unusable. */
export function localDateTimeToIso(local: string): string | undefined {
  const trimmed = local.trim();
  if (trimmed === "") return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function validateDecisionForm(
  state: DecisionFormState,
  now: Date = new Date(),
): DecisionFormValidation {
  const errors: DecisionFormErrors = {};

  if (state.title.trim() === "") errors.title = "titleRequired";

  if (state.scopeType !== "campaign" && state.scopeValue.trim() === "") {
    errors.scopeValue = "scopeRequired";
  }

  if (state.mode === "adjust-threshold") {
    const tolerance = parseOptionalNumber(state.tolerancePercent);
    if (tolerance.present && tolerance.value === undefined) {
      errors.tolerancePercent = "numberInvalid";
    }
    const threshold = parseOptionalNumber(state.thresholdValue);
    if (threshold.present && threshold.value === undefined) {
      errors.thresholdValue = "numberInvalid";
    }
  }

  const trimmedExpiry = state.expiresAtLocal.trim();
  if (trimmedExpiry !== "") {
    const iso = localDateTimeToIso(trimmedExpiry);
    if (iso === undefined) {
      errors.expiresAt = "expiryInvalid";
    } else if (new Date(iso).getTime() <= now.getTime()) {
      // Never let an operator create a decision that is already expired — the
      // server would surface it as expired, never active.
      errors.expiresAt = "expiryPast";
    }
  }

  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

function buildScope(state: DecisionFormState): ControlCentreDecisionScope | undefined {
  const value = state.scopeValue.trim();
  if (state.scopeType === "channel" && value !== "") return { channel: value };
  if (state.scopeType === "platform" && value !== "") return { platform: value };
  return undefined;
}

function buildEffect(state: DecisionFormState): ControlCentreDecisionEffect {
  if (state.mode !== "adjust-threshold") return { mode: state.mode };
  const tolerance = parseOptionalNumber(state.tolerancePercent);
  const threshold = parseOptionalNumber(state.thresholdValue);
  return {
    mode: state.mode,
    ...(tolerance.value !== undefined ? { tolerancePercent: tolerance.value } : {}),
    ...(threshold.value !== undefined ? { thresholdValue: threshold.value } : {}),
  };
}

/**
 * Builds the exact `record_campaign_decision` tool arguments from a validated
 * form. Optional fields are omitted (not sent as `undefined`) so the payload
 * matches the tool contract precisely under `exactOptionalPropertyTypes`.
 */
export function buildRecordDecisionArgs(
  state: DecisionFormState,
  campaignGroupId: string,
): RecordCampaignDecisionArgs {
  const reason = state.reason.trim();
  const scope = buildScope(state);
  const expiresAt = localDateTimeToIso(state.expiresAtLocal);

  return {
    campaignGroupId,
    title: state.title.trim(),
    effect: buildEffect(state),
    ...(reason !== "" ? { reason } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}
