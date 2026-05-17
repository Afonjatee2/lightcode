import { useState } from "react";
import { Button, ButtonGroup, Dropdown, Label, Tooltip } from "@heroui/react";
import { Check, ChevronDown, HelpCircle, Plug, ShieldAlert } from "lucide-react";
import {
  asPermissionRequestDetails,
  type CanonicalRequestType,
  type PermissionRequestDetails,
  type RequestOutcome,
  type ThreadServerRequestId,
  type UserInputOption,
} from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import type { OpenRuntimeRequest } from "@/renderer/state/slices/runtimeEventSlice";
import { ThreadDockSection } from "./ThreadDockUI";

interface ThreadRuntimeRequestPanelProps {
  threadId: string;
  request: OpenRuntimeRequest;
  agentLabel?: string | undefined;
  onResolve: (input: {
    requestId: ThreadServerRequestId;
    method: string;
    response: unknown;
  }) => Promise<void>;
  onPlanApproved?: () => void;
}

/**
 * Inline panel rendered inside the composer (above the input area) when the
 * supervisor emits a `request.opened` event for a GUI/structured thread.
 *
 * Renders two flavors based on `request.requestType`:
 *  - `tool_user_input` → vertical list of menu rows; click submits.
 *  - approval requests → primary action with chevron-dropdown for alternates,
 *    and negative options as ghost buttons.
 *
 * Resolves through `resolveThreadServerRequest` with `method: "requestPermission"`,
 * matching the existing renderer<->supervisor contract.
 */
export function ThreadRuntimeRequestPanel(props: ThreadRuntimeRequestPanelProps) {
  const { threadId, request, agentLabel, onResolve, onPlanApproved } = props;
  const [resolving, setResolving] = useState(false);

  function submitRaw(response: unknown, outcome: RequestOutcome) {
    if (resolving) return;
    setResolving(true);
    useAppStore.getState().applyRuntimeEvent(threadId, {
      type: "request.resolved",
      threadId,
      requestId: request.requestId,
      outcome,
    });
    void onResolve({
      requestId: request.requestId,
      method: "requestPermission",
      response,
    }).catch((err) => {
      console.error("[chat] request resolution failed", err);
      setResolving(false);
    });
  }

  function decide(optionIds: readonly string[]) {
    if (resolving) return;
    const primaryOptionId = optionIds[0];
    if (!primaryOptionId) return;
    if (
      request.requestType !== "tool_user_input" &&
      outcomeForSelection(request.requestType, primaryOptionId) === "accepted" &&
      isPlanApprovalRequest(request)
    ) {
      onPlanApproved?.();
    }
    submitRaw(
      optionIds.length === 1
        ? { optionId: primaryOptionId }
        : { optionId: primaryOptionId, optionIds },
      outcomeForSelection(request.requestType, primaryOptionId),
    );
  }

  const structuredElicitation = asStructuredElicitationDetails(request.payload.details);
  const userInputForm = !structuredElicitation
    ? asUserInputFormDetails(request.payload.details)
    : undefined;
  const options = request.payload.options ?? DEFAULT_APPROVAL_OPTIONS;
  const isQuestion = request.requestType === "tool_user_input";
  const isCustomForm = !!(structuredElicitation || userInputForm);
  const Icon = structuredElicitation ? Plug : isQuestion ? HelpCircle : ShieldAlert;
  const permissionDetails = !isCustomForm
    ? asPermissionRequestDetails(request.payload.details)
    : undefined;
  const opencodePermission =
    !permissionDetails && !isCustomForm
      ? asOpenCodePermissionDetails(request.payload.details)
      : undefined;
  const detailText =
    !permissionDetails && !opencodePermission && !isCustomForm && !isQuestion
      ? formatRawDetails(request.payload.details)
      : undefined;
  const agentLead = agentLabel ?? "The agent";
  const contextLine = structuredElicitation
    ? `${structuredElicitation.sourceText} needs input.`
    : isQuestion
      ? `${agentLead} needs your input to continue.`
      : undefined;
  const approvalActions =
    !isCustomForm && !isQuestion ? (
      <ApprovalActions
        options={options}
        requestType={request.requestType}
        isDisabled={resolving}
        onSelect={(optionId) => decide([optionId])}
      />
    ) : null;

  return (
    <ThreadDockSection className="!text-xs" placement="composer" collapsed={false}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1 px-2 py-1.5 leading-snug">
        <Icon
          className={`mt-0.5 size-3.5 shrink-0 ${structuredElicitation || isQuestion ? "text-foreground-muted" : "text-warning"}`}
        />
        <div className="min-w-0 flex-1 basis-96">
          <div className="font-semibold text-foreground">{request.payload.summary}</div>
          {contextLine ? (
            <div className="text-[11px] text-[color:var(--muted)]">{contextLine}</div>
          ) : null}
          {permissionDetails ? (
            <PermissionDetailsLine details={permissionDetails} />
          ) : opencodePermission ? (
            <OpenCodePermissionDetailsLine details={opencodePermission} />
          ) : !structuredElicitation && detailText ? (
            <pre className="mt-0.5 max-h-24 overflow-y-auto rounded-sm bg-foreground/5 p-1 font-mono text-[11px] whitespace-pre-wrap break-words">
              {detailText}
            </pre>
          ) : null}
        </div>
        {approvalActions ? (
          <div className="ml-auto shrink-0 self-end">{approvalActions}</div>
        ) : null}
      </div>

      {structuredElicitation ? (
        <StructuredElicitationForm
          params={structuredElicitation}
          isDisabled={resolving}
          onSubmit={(response, outcome) => submitRaw(response, outcome)}
        />
      ) : userInputForm ? (
        <UserInputForm
          details={userInputForm}
          isDisabled={resolving}
          onSubmit={(response, outcome) => submitRaw(response, outcome)}
        />
      ) : isQuestion ? (
        <QuestionRows
          options={options}
          isDisabled={resolving}
          onSubmit={decide}
          multiSelect={request.payload.multiSelect === true}
        />
      ) : null}
    </ThreadDockSection>
  );
}

function isPlanApprovalRequest(request: OpenRuntimeRequest): boolean {
  const details = asPermissionRequestDetails(request.payload.details);
  if (!details) return false;
  return details.toolName === "ExitPlanMode" || details.toolName === "exit_plan_mode";
}

function outcomeForSelection(requestType: CanonicalRequestType, optionId: string): RequestOutcome {
  if (requestType === "tool_user_input") return "answered";
  return NEGATIVE_OPTION_PATTERN.test(optionId) ? "declined" : "accepted";
}

const DEFAULT_APPROVAL_OPTIONS: UserInputOption[] = [
  { optionId: "allow", label: "Allow" },
  { optionId: "deny", label: "Deny" },
];

const NEGATIVE_OPTION_PATTERN = /(deny|denied|decline|reject|abort|cancel)/i;

function isNegativeOption(option: UserInputOption): boolean {
  return (
    NEGATIVE_OPTION_PATTERN.test(option.optionId) || NEGATIVE_OPTION_PATTERN.test(option.label)
  );
}

type OpenCodePermissionDetails = {
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown> | undefined;
};

function asOpenCodePermissionDetails(value: unknown): OpenCodePermissionDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.permission !== "string") return undefined;
  const patterns = Array.isArray(obj.patterns)
    ? obj.patterns.filter((p): p is string => typeof p === "string")
    : [];
  const metadata =
    obj.metadata && typeof obj.metadata === "object"
      ? (obj.metadata as Record<string, unknown>)
      : undefined;
  return { permission: obj.permission, patterns, metadata };
}

// ── Structured elicitation ──────────────────────────────────────────────

type StructuredElicitationSchemaProperty =
  | {
      type: "string";
      title?: string;
      description?: string;
      default?: string;
      enum?: string[];
      enumNames?: string[];
      oneOf?: Array<{ const: string; title?: string }>;
    }
  | {
      type: "integer" | "number";
      title?: string;
      description?: string;
      default?: number;
    }
  | {
      type: "boolean";
      title?: string;
      description?: string;
      default?: boolean;
    }
  | {
      type: "array";
      title?: string;
      description?: string;
      default?: string[];
      items?: {
        enum?: string[];
        enumNames?: string[];
        oneOf?: Array<{ const: string; title?: string }>;
      };
    };

type StructuredElicitationParams =
  | {
      mode: "form";
      message: string;
      sourceText: string;
      _meta?: unknown;
      requestedSchema: {
        type: "object";
        properties: Record<string, StructuredElicitationSchemaProperty>;
        required?: string[];
      };
    }
  | {
      mode: "url";
      message: string;
      sourceText: string;
      url: string;
      elicitationId: string;
      _meta?: unknown;
    };

function asStructuredElicitationDetails(value: unknown): StructuredElicitationParams | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const mcp = obj.mcpElicitation;
  if (mcp && typeof mcp === "object") {
    return parseStructuredElicitationCandidate(mcp, getMcpElicitationSourceText);
  }
  const acp = obj.acpElicitation;
  if (acp && typeof acp === "object") {
    return parseStructuredElicitationCandidate(acp, getAcpElicitationSourceText);
  }
  return parseStructuredElicitationCandidate(value, getMcpElicitationSourceText);
}

function parseStructuredElicitationCandidate(
  candidate: unknown,
  getSourceText: (obj: Record<string, unknown>) => string | undefined,
): StructuredElicitationParams | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const obj = candidate as Record<string, unknown>;
  const mode = obj.mode;
  if (mode !== "form" && mode !== "url") return undefined;
  if (typeof obj.message !== "string") return undefined;
  const sourceText = getSourceText(obj);
  if (!sourceText) return undefined;
  if (mode === "url") {
    if (typeof obj.url !== "string" || typeof obj.elicitationId !== "string") return undefined;
    return {
      mode: "url",
      message: obj.message,
      sourceText,
      url: obj.url,
      elicitationId: obj.elicitationId,
      ...(Object.hasOwn(obj, "_meta") ? { _meta: obj._meta } : {}),
    };
  }
  const schema = obj.requestedSchema;
  if (!schema || typeof schema !== "object") return undefined;
  const schemaObj = schema as Record<string, unknown>;
  if (
    (schemaObj.type !== undefined && schemaObj.type !== "object") ||
    (schemaObj.properties !== undefined && typeof schemaObj.properties !== "object")
  ) {
    return undefined;
  }
  const rawRequired = schemaObj.required;
  const required = Array.isArray(rawRequired)
    ? rawRequired.filter((key): key is string => typeof key === "string")
    : [];
  return {
    mode: "form",
    message: obj.message,
    sourceText,
    requestedSchema: {
      type: "object",
      properties: (schemaObj.properties ?? {}) as Record<
        string,
        StructuredElicitationSchemaProperty
      >,
      ...(required.length > 0 ? { required } : {}),
    },
    ...(Object.hasOwn(obj, "_meta") ? { _meta: obj._meta } : {}),
  };
}

function getMcpElicitationSourceText(obj: Record<string, unknown>): string | undefined {
  return typeof obj.serverName === "string" && obj.serverName.length > 0
    ? `MCP server "${obj.serverName}"`
    : undefined;
}

function getAcpElicitationSourceText(obj: Record<string, unknown>): string {
  const agentName =
    typeof obj.agentName === "string" && obj.agentName.length > 0 ? obj.agentName : undefined;
  return agentName ? `ACP agent "${agentName}"` : "ACP agent";
}

type StructuredFormValue = boolean | number | string | string[];

function getStructuredElicitationEnumOptions(
  property: StructuredElicitationSchemaProperty,
): { id: string; label: string }[] {
  if ("oneOf" in property && Array.isArray(property.oneOf)) {
    return property.oneOf.map((o) => ({ id: o.const, label: o.title ?? o.const }));
  }
  if ("enum" in property && Array.isArray(property.enum)) {
    const names =
      "enumNames" in property && Array.isArray(property.enumNames) ? property.enumNames : [];
    return property.enum.map((v, i) => ({ id: v, label: names[i] ?? v }));
  }
  if (property.type === "array" && property.items) {
    if (Array.isArray(property.items.oneOf)) {
      return property.items.oneOf.map((o) => ({ id: o.const, label: o.title ?? o.const }));
    }
    if (Array.isArray(property.items.enum)) {
      const names = Array.isArray(property.items.enumNames) ? property.items.enumNames : [];
      return property.items.enum.map((v, i) => ({ id: v, label: names[i] ?? v }));
    }
  }
  return [];
}

function getInitialStructuredFormValues(schema: {
  properties: Record<string, StructuredElicitationSchemaProperty>;
}): Record<string, StructuredFormValue> {
  const initial: Record<string, StructuredFormValue> = {};
  for (const [key, property] of Object.entries(schema.properties)) {
    if (property.type === "boolean") initial[key] = property.default ?? false;
    else if (property.type === "integer" || property.type === "number")
      initial[key] = property.default ?? "";
    else if (property.type === "array") initial[key] = property.default ?? [];
    else initial[key] = property.default ?? "";
  }
  return initial;
}

function isEmptyRequiredValue(value: StructuredFormValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function StructuredElicitationForm(props: {
  params: StructuredElicitationParams;
  isDisabled: boolean;
  onSubmit: (response: unknown, outcome: RequestOutcome) => void;
}) {
  const { params, isDisabled, onSubmit } = props;
  const [formValues, setFormValues] = useState<Record<string, StructuredFormValue>>(() =>
    params.mode === "form" ? getInitialStructuredFormValues(params.requestedSchema) : {},
  );
  const requiredKeys = params.mode === "form" ? (params.requestedSchema.required ?? []) : [];
  const hasMissing =
    params.mode === "form" && requiredKeys.some((key) => isEmptyRequiredValue(formValues[key]));

  function submitAccept() {
    onSubmit(
      {
        action: "accept",
        ...(params.mode === "form" ? { content: formValues } : {}),
        ...(Object.hasOwn(params, "_meta") ? { _meta: params._meta } : {}),
      },
      "answered",
    );
  }

  return (
    <div className="space-y-2 border-t border-[color:var(--border)] px-2 py-1.5">
      {params.mode === "url" ? (
        <a
          className="text-xs font-medium text-[color:var(--accent)] underline-offset-4 hover:underline"
          href={params.url}
          rel="noreferrer"
          target="_blank"
        >
          Open required URL
        </a>
      ) : (
        <div className="space-y-2">
          {Object.entries(params.requestedSchema.properties).map(([key, property]) => {
            const label = property.title ?? key;
            const description = property.description ?? "";
            const enumOpts = getStructuredElicitationEnumOptions(property);
            const isRequired = requiredKeys.includes(key);
            return (
              <div key={key} className="space-y-1">
                <div>
                  <p className="text-[11px] font-medium text-foreground">
                    {label}
                    {isRequired ? <span className="text-warning"> *</span> : null}
                  </p>
                  {description ? (
                    <p className="text-[11px] text-[color:var(--muted)]">{description}</p>
                  ) : null}
                </div>
                {property.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-[11px] text-foreground">
                    <input
                      type="checkbox"
                      className="size-3.5"
                      disabled={isDisabled}
                      checked={Boolean(formValues[key])}
                      onChange={(e) =>
                        setFormValues((cur) => ({ ...cur, [key]: e.target.checked }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ) : property.type === "integer" || property.type === "number" ? (
                  <input
                    type="number"
                    disabled={isDisabled}
                    value={formValues[key] === "" ? "" : String(formValues[key] ?? "")}
                    onChange={(e) =>
                      setFormValues((cur) => ({
                        ...cur,
                        [key]: e.target.value.trim().length === 0 ? "" : Number(e.target.value),
                      }))
                    }
                    className="w-full rounded border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1 text-[11px] text-foreground outline-none"
                  />
                ) : property.type === "array" ? (
                  <div className="space-y-0.5">
                    {enumOpts.map((option) => {
                      const current = Array.isArray(formValues[key])
                        ? (formValues[key] as string[])
                        : [];
                      const checked = current.includes(option.id);
                      return (
                        <label
                          key={option.id}
                          className="flex items-center gap-2 text-[11px] text-foreground"
                        >
                          <input
                            type="checkbox"
                            disabled={isDisabled}
                            className="size-3.5"
                            checked={checked}
                            onChange={(e) =>
                              setFormValues((cur) => {
                                const next = Array.isArray(cur[key])
                                  ? [...(cur[key] as string[])]
                                  : [];
                                return {
                                  ...cur,
                                  [key]: e.target.checked
                                    ? [...next, option.id]
                                    : next.filter((v) => v !== option.id),
                                };
                              })
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : enumOpts.length > 0 ? (
                  <select
                    disabled={isDisabled}
                    value={String(formValues[key] ?? "")}
                    onChange={(e) => setFormValues((cur) => ({ ...cur, [key]: e.target.value }))}
                    className="w-full rounded border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1 text-[11px] text-foreground outline-none"
                  >
                    <option value="">—</option>
                    {enumOpts.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    disabled={isDisabled}
                    value={String(formValues[key] ?? "")}
                    onChange={(e) => setFormValues((cur) => ({ ...cur, [key]: e.target.value }))}
                    className="w-full rounded border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1 text-[11px] text-foreground outline-none"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1 pt-1">
        <Button
          isDisabled={isDisabled}
          size="sm"
          variant="ghost"
          className="text-muted"
          onPress={() => onSubmit({ action: "cancel" }, "cancelled")}
        >
          Cancel
        </Button>
        <Button
          isDisabled={isDisabled}
          size="sm"
          variant="ghost"
          onPress={() => onSubmit({ action: "decline" }, "declined")}
        >
          Decline
        </Button>
        <Button
          isDisabled={isDisabled || hasMissing}
          size="sm"
          variant="secondary"
          onPress={submitAccept}
        >
          {params.mode === "url" ? "Continue" : "Submit"}
        </Button>
      </div>
    </div>
  );
}

// ── Structured user input forms ─────────────────────────────────────────

type UserInputFormOption = {
  optionId: string;
  label: string;
  description?: string;
};

type UserInputFormQuestion = {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  multiSelect: boolean;
  options: UserInputFormOption[] | null;
};

type UserInputFormDetails = {
  questions: UserInputFormQuestion[];
  responseShape: "answers-map" | "codex-request-user-input";
};

function asUserInputFormDetails(value: unknown): UserInputFormDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const generic = obj.userInputForm;
  if (generic && typeof generic === "object") {
    const questions = readUserInputFormQuestions(
      (generic as { questions?: unknown }).questions,
      "generic",
    );
    if (questions.length > 0) return { questions, responseShape: "answers-map" };
  }

  const codex = obj.codexUserInput;
  if (codex && typeof codex === "object") {
    const questions = readUserInputFormQuestions(
      (codex as { questions?: unknown }).questions,
      "codex",
    );
    if (questions.length > 0) return { questions, responseShape: "codex-request-user-input" };
  }

  return undefined;
}

function readUserInputFormQuestions(
  raw: unknown,
  source: "generic" | "codex",
): UserInputFormQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: UserInputFormQuestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.question !== "string" || e.question.length === 0) continue;
    const id = typeof e.id === "string" && e.id.length > 0 ? e.id : e.question;
    const header =
      typeof e.header === "string" && e.header.length > 0
        ? e.header
        : source === "codex"
          ? e.question
          : id;
    const options =
      Array.isArray(e.options) && e.options.length > 0
        ? e.options.flatMap((opt) => {
            if (!opt || typeof opt !== "object") return [];
            const o = opt as Record<string, unknown>;
            if (typeof o.label !== "string" || o.label.length === 0) return [];
            const optionId =
              typeof o.optionId === "string" && o.optionId.length > 0 ? o.optionId : o.label;
            return [
              {
                optionId,
                label: o.label,
                ...(typeof o.description === "string" && o.description.length > 0
                  ? { description: o.description }
                  : {}),
              },
            ];
          })
        : null;
    questions.push({
      id,
      header,
      question: e.question,
      isSecret: e.isSecret === true,
      multiSelect: e.multiSelect === true,
      options,
    });
  }
  return questions;
}

type UserInputFormAnswer = string | string[];

function initialUserInputFormAnswers(
  questions: readonly UserInputFormQuestion[],
): Record<string, UserInputFormAnswer> {
  return Object.fromEntries(questions.map((q) => [q.id, q.multiSelect ? [] : ""]));
}

function singleUserInputValue(value: UserInputFormAnswer | undefined): string {
  return typeof value === "string" ? value : "";
}

function userInputValueList(value: UserInputFormAnswer | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function UserInputForm(props: {
  details: UserInputFormDetails;
  isDisabled: boolean;
  onSubmit: (response: unknown, outcome: RequestOutcome) => void;
}) {
  const { details, isDisabled, onSubmit } = props;
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, UserInputFormAnswer>>(() =>
    initialUserInputFormAnswers(details.questions),
  );
  const activeQuestion = details.questions[activeIndex] ?? details.questions[0];
  if (!activeQuestion) return null;

  function setAnswer(questionId: string, value: UserInputFormAnswer) {
    setAnswers((cur) => (cur[questionId] === value ? cur : { ...cur, [questionId]: value }));
  }

  function answerSingleChoice(questionId: string, optionId: string) {
    setAnswer(questionId, optionId);
    setActiveIndex((index) => Math.min(index + 1, details.questions.length - 1));
  }

  function toggleAnswer(questionId: string, optionId: string) {
    setAnswers((cur) => {
      const selected = userInputValueList(cur[questionId]);
      const next = selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId];
      return { ...cur, [questionId]: next };
    });
  }

  function submit() {
    if (details.responseShape === "codex-request-user-input") {
      onSubmit(
        {
          answers: Object.fromEntries(
            details.questions.map((question) => {
              const value = answers[question.id];
              const values = Array.isArray(value) ? value : value ? [value] : [];
              return [question.id, { answers: values }];
            }),
          ),
        },
        "answered",
      );
      return;
    }

    onSubmit(
      {
        answers: Object.fromEntries(
          details.questions.map((question) => [question.id, answers[question.id]]),
        ),
      },
      "answered",
    );
  }

  return (
    <div className="space-y-2 border-t border-[color:var(--border)] px-2 py-1.5">
      <QuestionSwitcher
        questions={details.questions}
        answers={answers}
        activeIndex={activeIndex}
        isDisabled={isDisabled}
        onSelect={setActiveIndex}
      />
      <div className="space-y-1">
        <div>
          <p className="text-[11px] font-medium text-foreground">{activeQuestion.header}</p>
          <p className="text-[11px] text-[color:var(--muted)]">{activeQuestion.question}</p>
        </div>
        {activeQuestion.options ? (
          <div
            role="listbox"
            aria-label={activeQuestion.header}
            {...(activeQuestion.multiSelect ? { "aria-multiselectable": true } : {})}
            className="flex flex-col"
          >
            {activeQuestion.options.map((option, index) => (
              <QuestionOptionRow
                key={option.optionId}
                index={index}
                option={option}
                isDisabled={isDisabled}
                {...(activeQuestion.multiSelect
                  ? {
                      checked: userInputValueList(answers[activeQuestion.id]).includes(
                        option.optionId,
                      ),
                    }
                  : {
                      selected:
                        singleUserInputValue(answers[activeQuestion.id]) === option.optionId,
                    })}
                onClick={() => {
                  if (activeQuestion.multiSelect) {
                    toggleAnswer(activeQuestion.id, option.optionId);
                    return;
                  }
                  answerSingleChoice(activeQuestion.id, option.optionId);
                }}
              />
            ))}
          </div>
        ) : activeQuestion.isSecret ? (
          <input
            type="password"
            disabled={isDisabled}
            value={singleUserInputValue(answers[activeQuestion.id])}
            onChange={(e) => setAnswer(activeQuestion.id, e.target.value)}
            className="w-full rounded border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1 text-[11px] text-foreground outline-none"
          />
        ) : (
          <textarea
            disabled={isDisabled}
            rows={2}
            value={singleUserInputValue(answers[activeQuestion.id])}
            onChange={(e) => setAnswer(activeQuestion.id, e.target.value)}
            className="w-full rounded border border-[color:var(--border)] bg-[var(--composer-surface)] px-2 py-1 text-[11px] text-foreground outline-none"
          />
        )}
      </div>
      <div className="flex justify-end pt-1">
        <Button isDisabled={isDisabled} size="sm" variant="secondary" onPress={submit}>
          Submit
        </Button>
      </div>
    </div>
  );
}

function QuestionSwitcher(props: {
  questions: readonly UserInputFormQuestion[];
  answers: Record<string, UserInputFormAnswer>;
  activeIndex: number;
  isDisabled: boolean;
  onSelect: (index: number) => void;
}) {
  const { questions, answers, activeIndex, isDisabled, onSelect } = props;
  if (questions.length <= 1) return null;
  return (
    <div role="tablist" aria-label="Questions" className="flex gap-1 overflow-x-auto pb-0.5">
      {questions.map((question, index) => {
        const isActive = index === activeIndex;
        const hasAnswer = hasUserInputAnswer(answers[question.id]);
        return (
          <button
            key={question.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={isDisabled}
            onClick={() => onSelect(index)}
            className={`flex min-w-0 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-60 ${
              isActive
                ? "bg-foreground/10 text-foreground"
                : "text-[color:var(--muted)] hover:bg-foreground/5 hover:text-foreground"
            }`}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-foreground/20 text-[9px] [font-variant-numeric:tabular-nums]">
              {hasAnswer ? <Check className="size-2.5" /> : index + 1}
            </span>
            <span className="max-w-32 truncate">{question.header}</span>
          </button>
        );
      })}
    </div>
  );
}

function hasUserInputAnswer(value: UserInputFormAnswer | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.length > 0;
}

function OpenCodePermissionDetailsLine({ details }: { details: OpenCodePermissionDetails }) {
  const metadataEntries = details.metadata
    ? Object.entries(details.metadata).filter(([, v]) => v !== undefined && v !== null)
    : [];
  return (
    <div className="mt-0.5 space-y-0.5 font-mono text-[11px]">
      <div>
        <span className="text-foreground/60">permission</span>
        <span className="ml-1 text-foreground">{details.permission}</span>
      </div>
      {details.patterns.length > 0 ? (
        <div className="break-words">
          <span className="text-foreground/60">
            {details.patterns.length === 1 ? "target" : "targets"}
          </span>
          <span className="ml-1 text-foreground">{details.patterns.join(", ")}</span>
        </div>
      ) : null}
      {metadataEntries.map(([key, value]) => (
        <div key={key} className="break-words">
          <span className="text-foreground/60">{key}</span>
          <span className="ml-1 text-foreground">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PermissionDetailsLine({ details }: { details: PermissionRequestDetails }) {
  const subject = details.description ?? formatInputSubject(details.input);
  const label = details.displayName ?? details.toolName;
  return (
    <div className="mt-0.5 space-y-0.5">
      <div className="font-mono text-[11px] text-foreground/80">
        <span className="text-foreground/60">{label}</span>
        {subject ? <span className="ml-1 text-foreground">{subject}</span> : null}
      </div>
      {details.decisionReason ? (
        <div className="text-[11px] text-warning-600 dark:text-warning-400">
          {details.decisionReason}
        </div>
      ) : null}
      {details.blockedPath ? (
        <div className="font-mono text-[11px] text-foreground/60">
          blocked: <span className="text-foreground/80">{details.blockedPath}</span>
        </div>
      ) : null}
    </div>
  );
}

function QuestionRows(props: {
  options: readonly UserInputOption[];
  isDisabled: boolean;
  onSubmit: (optionIds: readonly string[]) => void;
  multiSelect: boolean;
}) {
  const { options, isDisabled, onSubmit, multiSelect } = props;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  if (!multiSelect) {
    return (
      <div role="listbox" aria-label="Options" className="flex flex-col px-1 pb-1">
        {options.map((option, index) => (
          <QuestionOptionRow
            key={option.optionId}
            index={index}
            option={option}
            isDisabled={isDisabled}
            onClick={() => onSubmit([option.optionId])}
          />
        ))}
      </div>
    );
  }

  function toggle(optionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  }

  const selectedIds = [...selected];
  return (
    <div
      role="listbox"
      aria-label="Options"
      aria-multiselectable="true"
      className="flex flex-col px-1 pb-1"
    >
      {options.map((option, index) => (
        <QuestionOptionRow
          key={option.optionId}
          index={index}
          option={option}
          isDisabled={isDisabled}
          checked={selected.has(option.optionId)}
          onClick={() => toggle(option.optionId)}
        />
      ))}
      <div className="flex justify-end gap-1 px-1 pt-1">
        <Button
          isDisabled={isDisabled || selectedIds.length === 0}
          size="sm"
          variant="secondary"
          onPress={() => onSubmit(selectedIds)}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}

function QuestionOptionRow(props: {
  index: number;
  option: UserInputOption;
  isDisabled: boolean;
  onClick: () => void;
  /** Single-select forms can mark the saved choice without changing row shape. */
  selected?: boolean;
  /** When defined, the row renders a checkbox marker (multi-select). */
  checked?: boolean;
}) {
  const { index, option, isDisabled, onClick, selected, checked } = props;
  const isMultiSelect = checked !== undefined;
  const tooltipBody = option.description ? (
    <div className="max-w-[28rem] space-y-1 whitespace-normal break-words">
      <div className="text-xs font-medium text-foreground">{option.label}</div>
      <div className="text-[11px] text-[color:var(--muted)]">{option.description}</div>
    </div>
  ) : null;

  const row = (
    <button
      type="button"
      role="option"
      aria-selected={isMultiSelect ? checked === true : selected === true}
      disabled={isDisabled}
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none disabled:opacity-60 disabled:hover:bg-transparent ${
        selected ? "bg-foreground/5" : ""
      }`}
    >
      {isMultiSelect ? (
        <span className="mt-0.5 flex size-3 shrink-0 items-center justify-center rounded border border-foreground/30 text-[9px] text-foreground [font-variant-numeric:tabular-nums]">
          {checked ? "x" : ""}
        </span>
      ) : (
        <span className="mt-px w-4 shrink-0 text-[11px] font-medium text-[color:var(--muted)] [font-variant-numeric:tabular-nums]">
          {`${index + 1}.`}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{option.label}</span>
        {option.description ? (
          <span
            className="block overflow-hidden text-[11px] leading-snug text-[color:var(--muted)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
            title={option.description}
          >
            {option.description}
          </span>
        ) : null}
      </span>
    </button>
  );

  if (!tooltipBody) return row;
  return (
    <Tooltip delay={400}>
      <Tooltip.Trigger>{row}</Tooltip.Trigger>
      <Tooltip.Content placement="right">{tooltipBody}</Tooltip.Content>
    </Tooltip>
  );
}

function ApprovalActions(props: {
  options: readonly UserInputOption[];
  requestType: CanonicalRequestType;
  isDisabled: boolean;
  onSelect: (optionId: string) => void;
}) {
  const { options, isDisabled, onSelect } = props;
  const negatives = options.filter(isNegativeOption);
  const positives = options.filter((o) => !isNegativeOption(o));
  const primary = positives[0];
  const positiveAlternates = positives.slice(1);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {negatives.map((option) => (
          <Button
            key={option.optionId}
            isDisabled={isDisabled}
            size="sm"
            variant="ghost"
            onPress={() => onSelect(option.optionId)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {primary ? (
          positiveAlternates.length > 0 ? (
            <ButtonGroup size="sm" variant="tertiary">
              <Button isDisabled={isDisabled} onPress={() => onSelect(primary.optionId)}>
                {primary.label}
              </Button>
              <Dropdown>
                <Button isIconOnly aria-label="More approval options" isDisabled={isDisabled}>
                  <ButtonGroup.Separator />
                  <ChevronDown className="size-3.5" />
                </Button>
                <Dropdown.Popover placement="top end">
                  <Dropdown.Menu onAction={(key) => onSelect(String(key))}>
                    {positiveAlternates.map((option) => (
                      <Dropdown.Item
                        key={option.optionId}
                        id={option.optionId}
                        textValue={option.label}
                      >
                        <Label>{option.label}</Label>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </ButtonGroup>
          ) : (
            <Button
              isDisabled={isDisabled}
              size="sm"
              variant="tertiary"
              onPress={() => onSelect(primary.optionId)}
            >
              {primary.label}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

function formatInputSubject(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  if (typeof obj.command === "string") return obj.command;
  if (typeof obj.file_path === "string") return obj.file_path;
  if (typeof obj.path === "string") return obj.path;
  if (typeof obj.url === "string") return obj.url;
  return undefined;
}

function formatRawDetails(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
