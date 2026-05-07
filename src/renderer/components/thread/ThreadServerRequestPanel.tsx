import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { ButtonGroup } from "@heroui/react";
import { HelpCircle, Plug, ShieldAlert } from "lucide-react";
import type { ThreadServerRequestId } from "@/shared/contracts";
import type { PendingThreadServerRequest } from "@/renderer/state/appStore";
import { Button, Input, PathDisplay, Select, TextArea } from "@/renderer/components/common";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getQuestionAnswerRecord(questions: RequestQuestion[]): Record<string, string> {
  return Object.fromEntries(questions.map((question) => [question.id, ""]));
}

type RequestQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

type UserInputRequestParams = {
  questions: RequestQuestion[];
};

type McpElicitationSchemaProperty =
  | {
      type: "string";
      title?: string;
      description?: string;
      minLength?: number;
      maxLength?: number;
      default?: string;
      enum?: string[];
      enumNames?: string[];
      oneOf?: Array<{ const: string; title?: string }>;
    }
  | {
      type: "integer" | "number";
      title?: string;
      description?: string;
      minimum?: number;
      maximum?: number;
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
      minItems?: number;
      maxItems?: number;
      default?: string[];
      items?: {
        enum?: string[];
        enumNames?: string[];
        oneOf?: Array<{ const: string; title?: string }>;
      };
    };

type McpElicitationFormParams = {
  mode: "form";
  message: string;
  serverName: string;
  _meta?: unknown;
  requestedSchema: {
    type: "object";
    properties: Record<string, McpElicitationSchemaProperty>;
    required?: string[];
  };
};

type McpElicitationUrlParams = {
  mode: "url";
  message: string;
  serverName: string;
  url: string;
  elicitationId: string;
  _meta?: unknown;
};

type CommandApprovalParams = {
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  grantRoot?: string | null;
  permissions?: unknown;
  availableDecisions?: unknown[] | null;
};

type AcpPermissionOption = {
  optionId: string;
  name: string;
  kind?: string | null;
};

type AcpPermissionRequestParams = {
  toolCall: {
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
  };
  options: AcpPermissionOption[];
};

function parseUserInputRequestParams(params: unknown): UserInputRequestParams | undefined {
  if (!isRecord(params) || !Array.isArray(params.questions)) {
    return undefined;
  }

  const questions = params.questions.flatMap((question): RequestQuestion[] => {
    if (!isRecord(question)) {
      return [];
    }

    const id = asString(question.id);
    const header = asString(question.header);
    const prompt = asString(question.question);
    if (!id || !header || !prompt) {
      return [];
    }

    const options =
      Array.isArray(question.options) && question.options.length > 0
        ? question.options.flatMap((option) => {
            if (!isRecord(option)) {
              return [];
            }
            const label = asString(option.label);
            const description = asString(option.description);
            return label && description ? [{ label, description }] : [];
          })
        : null;

    return [
      {
        id,
        header,
        question: prompt,
        isOther: question.isOther === true,
        isSecret: question.isSecret === true,
        options,
      },
    ];
  });

  return questions.length > 0 ? { questions } : undefined;
}

function parseMcpElicitationParams(
  params: unknown,
): McpElicitationFormParams | McpElicitationUrlParams | undefined {
  if (!isRecord(params)) {
    return undefined;
  }

  const mode = asString(params.mode);
  const message = asString(params.message);
  const serverName = asString(params.serverName);
  if (!mode || !message || !serverName) {
    return undefined;
  }

  if (mode === "url") {
    const url = asString(params.url);
    const elicitationId = asString(params.elicitationId);
    if (!url || !elicitationId) {
      return undefined;
    }
    return {
      mode: "url",
      message,
      serverName,
      url,
      elicitationId,
      ...(Object.hasOwn(params, "_meta") ? { _meta: params._meta } : {}),
    };
  }

  if (
    mode === "form" &&
    isRecord(params.requestedSchema) &&
    params.requestedSchema.type === "object"
  ) {
    const properties = isRecord(params.requestedSchema.properties)
      ? params.requestedSchema.properties
      : {};
    const required = Array.isArray(params.requestedSchema.required)
      ? params.requestedSchema.required.filter((item): item is string => typeof item === "string")
      : undefined;

    return {
      mode: "form",
      message,
      serverName,
      requestedSchema: {
        type: "object",
        properties: properties as Record<string, McpElicitationSchemaProperty>,
        ...(required ? { required } : {}),
      },
      ...(Object.hasOwn(params, "_meta") ? { _meta: params._meta } : {}),
    };
  }

  return undefined;
}

function parseCommandApprovalParams(params: unknown): CommandApprovalParams {
  if (!isRecord(params)) {
    return {};
  }

  return {
    ...(Object.hasOwn(params, "reason") ? { reason: asString(params.reason) ?? null } : {}),
    ...(Object.hasOwn(params, "command")
      ? {
          command:
            typeof params.command === "string"
              ? params.command
              : Array.isArray(params.command)
                ? params.command
                    .filter((item): item is string => typeof item === "string")
                    .join(" ")
                : null,
        }
      : {}),
    ...(Object.hasOwn(params, "cwd") ? { cwd: asString(params.cwd) ?? null } : {}),
    ...(Object.hasOwn(params, "grantRoot")
      ? { grantRoot: asString(params.grantRoot) ?? null }
      : {}),
    ...(Object.hasOwn(params, "permissions") ? { permissions: params.permissions } : {}),
    ...(Array.isArray(params.availableDecisions)
      ? { availableDecisions: params.availableDecisions }
      : {}),
  };
}

function parseAcpPermissionRequestParams(params: unknown): AcpPermissionRequestParams | undefined {
  if (!isRecord(params) || !isRecord(params.toolCall) || !Array.isArray(params.options)) {
    return undefined;
  }

  const options = params.options.flatMap((option): AcpPermissionOption[] => {
    if (!isRecord(option)) {
      return [];
    }
    const optionId = asString(option.optionId);
    const name = asString(option.name);
    if (!optionId || !name) {
      return [];
    }
    return [
      {
        optionId,
        name,
        ...(Object.hasOwn(option, "kind") ? { kind: asString(option.kind) ?? null } : {}),
      },
    ];
  });

  return options.length > 0
    ? {
        toolCall: {
          ...(Object.hasOwn(params.toolCall, "title")
            ? { title: asString(params.toolCall.title) ?? null }
            : {}),
          ...(Object.hasOwn(params.toolCall, "kind")
            ? { kind: asString(params.toolCall.kind) ?? null }
            : {}),
          ...(Object.hasOwn(params.toolCall, "rawInput")
            ? { rawInput: params.toolCall.rawInput }
            : {}),
        },
        options,
      }
    : undefined;
}

function getCommandDecisionLabel(decision: unknown): string {
  if (decision === "accept") {
    return "Approve";
  }
  if (decision === "acceptForSession") {
    return "Approve for session";
  }
  if (decision === "decline") {
    return "Decline";
  }
  if (decision === "cancel") {
    return "Cancel";
  }
  if (isRecord(decision) && isRecord(decision.acceptWithExecpolicyAmendment)) {
    return "Approve and allow similar";
  }
  if (
    isRecord(decision) &&
    isRecord(decision.applyNetworkPolicyAmendment) &&
    isRecord(decision.applyNetworkPolicyAmendment.network_policy_amendment)
  ) {
    const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
    const action = asString(amendment.action) ?? "apply";
    const host = asString(amendment.host) ?? "host";
    return `${action === "allow" ? "Allow" : "Deny"} ${host}`;
  }
  return "Respond";
}

function getLegacyDecisionLabel(decision: string): string {
  switch (decision) {
    case "approved":
      return "Approve";
    case "approved_for_session":
      return "Approve for session";
    case "denied":
      return "Decline";
    case "abort":
      return "Abort";
    default:
      return decision;
  }
}

function getMcpEnumOptions(property: McpElicitationSchemaProperty) {
  if ("oneOf" in property && Array.isArray(property.oneOf)) {
    return property.oneOf
      .filter((option) => isRecord(option) && typeof option.const === "string")
      .map((option) => ({
        id: option.const,
        label: asString(option.title) ?? option.const,
      }));
  }

  if ("enum" in property && Array.isArray(property.enum)) {
    return property.enum.map((option, index) => ({
      id: option,
      label:
        Array.isArray(property.enumNames) && typeof property.enumNames[index] === "string"
          ? property.enumNames[index]
          : option,
    }));
  }

  if (
    property.type === "array" &&
    property.items &&
    "oneOf" in property.items &&
    Array.isArray(property.items.oneOf)
  ) {
    return property.items.oneOf
      .filter((option) => isRecord(option) && typeof option.const === "string")
      .map((option) => ({
        id: option.const,
        label: asString(option.title) ?? option.const,
      }));
  }

  const arrayItems = property.type === "array" ? property.items : undefined;
  if (arrayItems && Array.isArray(arrayItems.enum)) {
    return arrayItems.enum.map((option, index) => ({
      id: option,
      label:
        Array.isArray(arrayItems.enumNames) && typeof arrayItems.enumNames[index] === "string"
          ? arrayItems.enumNames[index]
          : option,
    }));
  }

  return [];
}

function getInitialMcpFormValues(
  schema: McpElicitationFormParams["requestedSchema"],
): Record<string, boolean | number | string | string[]> {
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, property]) => {
      if (property.type === "boolean") {
        return [key, property.default ?? false];
      }
      if (property.type === "integer" || property.type === "number") {
        return [key, property.default ?? ""];
      }
      if (property.type === "array") {
        return [key, property.default ?? []];
      }
      return [key, property.default ?? ""];
    }),
  );
}

function isEmptyRequiredValue(value: boolean | number | string | string[]): boolean {
  if (typeof value === "boolean") {
    return false;
  }
  if (typeof value === "number") {
    return Number.isNaN(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return String(value).trim().length === 0;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveAgentLead(agentLabel?: string): string {
  const trimmed = agentLabel?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "The agent";
}

type DetailRow = {
  label: string;
  value: string;
  isPath?: boolean;
  mono?: boolean;
};

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

function ApprovalDetailRow(props: DetailRow) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 px-2 py-0.5 leading-tight">
      <dt className="w-[5.5rem] shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted/80">
        {props.label}
      </dt>
      <dd
        className={`min-w-0 flex-1 ${props.mono ? "font-mono" : ""} text-foreground`}
        title={props.value}
      >
        {props.isPath ? (
          <PathDisplay path={props.value} />
        ) : (
          <span className="block truncate">{props.value}</span>
        )}
      </dd>
    </div>
  );
}

type ActionDescriptor = {
  key: string;
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
};

function ApprovalActionBar(props: {
  cancel?: ActionDescriptor | null;
  extraNegatives?: ActionDescriptor[];
  positives: ActionDescriptor[];
  isDisabled?: boolean;
}) {
  const { cancel, extraNegatives = [], positives, isDisabled = false } = props;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        {cancel ? (
          <Button
            isDisabled={isDisabled || cancel.isDisabled === true}
            size="sm"
            variant="ghost"
            onPress={cancel.onPress}
          >
            {cancel.label}
          </Button>
        ) : (
          <span />
        )}
        {extraNegatives.map((action) => (
          <Button
            key={action.key}
            isDisabled={isDisabled || action.isDisabled === true}
            size="sm"
            variant="ghost"
            onPress={action.onPress}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {positives.length > 0 ? (
        <ButtonGroup size="sm">
          {positives.map((action, idx) => (
            <Button
              key={action.key}
              isDisabled={isDisabled || action.isDisabled === true}
              variant={idx === 0 ? "primary" : "secondary"}
              onPress={action.onPress}
            >
              {action.label}
            </Button>
          ))}
        </ButtonGroup>
      ) : null}
    </div>
  );
}

function RequestShell(props: {
  title: string;
  description: string;
  details?: DetailRow[];
  body?: ReactNode;
  footer?: ReactNode;
  icon?: LucideIcon;
}) {
  const { title, description, details = [], body, footer, icon: Icon = ShieldAlert } = props;

  return (
    <section
      aria-label={title}
      className="mx-2 mt-2 mb-2 flex flex-col rounded-2xl border border-warning-300/40 bg-[var(--composer-surface)] text-xs"
    >
      <div className="flex items-start gap-2 px-2.5 pt-2 pb-1.5 leading-tight">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">{title}</div>
          <div className="mt-0.5 line-clamp-3 text-[color:var(--muted)]">{description}</div>
        </div>
      </div>

      {details.length > 0 ? (
        <dl className="px-0.5 pb-1.5">
          {details.map((detail) => (
            <ApprovalDetailRow key={`${detail.label}-${detail.value}`} {...detail} />
          ))}
        </dl>
      ) : null}

      {body ? (
        <div className="max-h-[55vh] overflow-y-auto px-2.5 pb-2 [scrollbar-gutter:stable]">
          {body}
        </div>
      ) : null}

      {footer ? (
        <div className="border-t border-[color:var(--border)] px-2 py-1.5">{footer}</div>
      ) : null}
    </section>
  );
}

function UserInputRequestCard(props: {
  params: UserInputRequestParams;
  agentLabel?: string | undefined;
  onResolve: (response: unknown) => Promise<void>;
}) {
  const { params, agentLabel, onResolve } = props;
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    getQuestionAnswerRecord(params.questions),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const agentLead = resolveAgentLead(agentLabel);

  const submit = async () => {
    setIsSubmitting(true);
    try {
      await onResolve({
        answers: Object.fromEntries(
          Object.entries(answers).map(([id, value]) => [id, { answers: value ? [value] : [] }]),
        ),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequestShell
      icon={HelpCircle}
      title="Input requested"
      description={`${agentLead} is waiting for more information before it can continue.`}
      body={
        <div className="space-y-3">
          {params.questions.map((question) => (
            <div key={question.id} className="space-y-1.5">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">{question.header}</p>
                <p className="text-xs text-muted">{question.question}</p>
              </div>
              {question.options ? (
                <Select
                  options={question.options.map((option) => ({
                    id: option.label,
                    label: option.label,
                  }))}
                  value={answers[question.id] ?? ""}
                  onChange={(value) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: value,
                    }))
                  }
                />
              ) : question.isSecret ? (
                <Input
                  fullWidth
                  type="password"
                  value={answers[question.id] ?? ""}
                  variant="secondary"
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                />
              ) : (
                <TextArea
                  fullWidth
                  rows={question.isOther ? 2 : 3}
                  value={answers[question.id] ?? ""}
                  variant="secondary"
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                />
              )}
            </div>
          ))}
        </div>
      }
      footer={
        <ApprovalActionBar
          isDisabled={isSubmitting}
          positives={[{ key: "submit", label: "Submit", onPress: () => void submit() }]}
        />
      }
    />
  );
}

function McpElicitationRequestCard(props: {
  params: McpElicitationFormParams | McpElicitationUrlParams;
  onResolve: (response: unknown) => Promise<void>;
}) {
  const { params, onResolve } = props;
  const [formValues, setFormValues] = useState<
    Record<string, boolean | number | string | string[]>
  >(() => (params.mode === "form" ? getInitialMcpFormValues(params.requestedSchema) : {}));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requiredKeys = params.mode === "form" ? (params.requestedSchema.required ?? []) : [];
  const hasMissingRequiredField =
    params.mode === "form" &&
    requiredKeys.some((key) => isEmptyRequiredValue(formValues[key] ?? ""));

  const resolveWith = async (response: unknown) => {
    setIsSubmitting(true);
    try {
      await onResolve(response);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequestShell
      icon={Plug}
      title="MCP input requested"
      description={params.message}
      details={[{ label: "Server", value: params.serverName }]}
      body={
        params.mode === "url" ? (
          <a
            className="text-xs font-medium text-[color:var(--accent)] underline-offset-4 hover:underline"
            href={params.url}
            rel="noreferrer"
            target="_blank"
          >
            Open required URL
          </a>
        ) : (
          <div className="space-y-3">
            {Object.entries(params.requestedSchema.properties).map(([key, property]) => {
              const label = property.title ?? key;
              const description = property.description ?? "";
              const options = getMcpEnumOptions(property);

              return (
                <div key={key} className="space-y-1.5">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-foreground">{label}</p>
                    {description ? <p className="text-xs text-muted">{description}</p> : null}
                  </div>

                  {property.type === "boolean" ? (
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        checked={Boolean(formValues[key])}
                        className="size-4"
                        onChange={(event) =>
                          setFormValues((current) => ({
                            ...current,
                            [key]: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      <span>{label}</span>
                    </label>
                  ) : property.type === "integer" || property.type === "number" ? (
                    <Input
                      fullWidth
                      type="number"
                      value={formValues[key] === "" ? "" : String(formValues[key] ?? "")}
                      variant="secondary"
                      onChange={(event) =>
                        setFormValues((current) => ({
                          ...current,
                          [key]:
                            event.target.value.trim().length === 0
                              ? ""
                              : Number(event.target.value),
                        }))
                      }
                    />
                  ) : property.type === "array" ? (
                    <div className="grid gap-1.5">
                      {options.map((option) => {
                        const currentValues = Array.isArray(formValues[key])
                          ? (formValues[key] as string[])
                          : [];

                        return (
                          <label
                            key={option.id}
                            className="flex items-center gap-2 text-xs text-foreground"
                          >
                            <input
                              checked={currentValues.includes(option.id)}
                              className="size-4"
                              onChange={(event) =>
                                setFormValues((current) => {
                                  const nextValues = Array.isArray(current[key])
                                    ? [...(current[key] as string[])]
                                    : [];

                                  return {
                                    ...current,
                                    [key]: event.target.checked
                                      ? [...nextValues, option.id]
                                      : nextValues.filter((value) => value !== option.id),
                                  };
                                })
                              }
                              type="checkbox"
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : options.length > 0 ? (
                    <Select
                      options={options}
                      value={String(formValues[key] ?? "")}
                      onChange={(value) =>
                        setFormValues((current) => ({
                          ...current,
                          [key]: value,
                        }))
                      }
                    />
                  ) : (
                    <Input
                      fullWidth
                      value={String(formValues[key] ?? "")}
                      variant="secondary"
                      onChange={(event) =>
                        setFormValues((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        )
      }
      footer={
        <ApprovalActionBar
          isDisabled={isSubmitting}
          cancel={{
            key: "cancel",
            label: "Cancel",
            onPress: () => void resolveWith({ action: "cancel" }),
          }}
          extraNegatives={[
            {
              key: "decline",
              label: "Decline",
              onPress: () => void resolveWith({ action: "decline" }),
            },
          ]}
          positives={[
            {
              key: "continue",
              label: "Continue",
              isDisabled: hasMissingRequiredField,
              onPress: () =>
                void resolveWith({
                  action: "accept",
                  ...(params.mode === "form" ? { content: formValues } : {}),
                  ...(Object.hasOwn(params, "_meta") ? { _meta: params._meta } : {}),
                }),
            },
          ]}
        />
      }
    />
  );
}

type DecisionPolarity = "positive" | "negative";

function classifyDecision(decision: unknown): DecisionPolarity {
  if (
    decision === "decline" ||
    decision === "cancel" ||
    decision === "denied" ||
    decision === "abort"
  ) {
    return "negative";
  }
  if (isRecord(decision) && isRecord(decision.applyNetworkPolicyAmendment)) {
    const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
    if (isRecord(amendment) && asString(amendment.action) === "deny") {
      return "negative";
    }
  }
  return "positive";
}

function isCancelOrAbort(rawKey: string): boolean {
  try {
    const parsed = JSON.parse(rawKey);
    if (parsed === "cancel" || parsed === "abort") return true;
  } catch {
    // fall through to literal compare
  }
  return rawKey === "cancel" || rawKey === "abort";
}

function isRejectPermissionKind(kind: string | null | undefined): boolean {
  return kind === "reject_once" || kind === "reject_always";
}

type RawAction = {
  key: string;
  label: string;
  response: unknown;
  polarity: DecisionPolarity;
};

function AcpPermissionRequestCard(props: {
  params: AcpPermissionRequestParams;
  agentLabel?: string | undefined;
  onResolve: (response: unknown) => Promise<void>;
}) {
  const { params, agentLabel, onResolve } = props;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const agentLead = resolveAgentLead(agentLabel);
  const toolTitle = params.toolCall.title ?? params.toolCall.kind ?? "tool call";
  const actions: RawAction[] = params.options.map((option) => ({
    key: option.optionId,
    label: option.name,
    response: { optionId: option.optionId },
    polarity: isRejectPermissionKind(option.kind) ? "negative" : "positive",
  }));
  const positives = actions.filter((action) => action.polarity === "positive");
  const negatives = actions.filter((action) => action.polarity === "negative");
  const cancelRaw = negatives[0];
  const extraNegativesRaw = negatives.slice(1);

  const resolveWith = async (response: unknown) => {
    setIsSubmitting(true);
    try {
      await onResolve(response);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequestShell
      title="Permission requested"
      description={`${agentLead} is waiting for approval to run ${toolTitle}.`}
      details={[...(params.toolCall.kind ? [{ label: "Tool", value: params.toolCall.kind }] : [])]}
      body={
        Object.hasOwn(params.toolCall, "rawInput") ? (
          <pre className="overflow-x-auto rounded border border-[color:var(--border)] bg-foreground/[0.04] p-2 text-[11px] text-muted">
            {formatJson(params.toolCall.rawInput)}
          </pre>
        ) : null
      }
      footer={
        <ApprovalActionBar
          isDisabled={isSubmitting}
          cancel={
            cancelRaw
              ? {
                  key: cancelRaw.key,
                  label: cancelRaw.label,
                  onPress: () => void resolveWith(cancelRaw.response),
                }
              : null
          }
          extraNegatives={extraNegativesRaw.map((action) => ({
            key: action.key,
            label: action.label,
            onPress: () => void resolveWith(action.response),
          }))}
          positives={positives.map((action) => ({
            key: action.key,
            label: action.label,
            onPress: () => void resolveWith(action.response),
          }))}
        />
      }
    />
  );
}

function ApprovalRequestCard(props: {
  request: PendingThreadServerRequest;
  agentLabel?: string | undefined;
  onResolve: (response: unknown) => Promise<void>;
}) {
  const { request, agentLabel, onResolve } = props;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const params = parseCommandApprovalParams(request.params);
  const agentLead = resolveAgentLead(agentLabel);

  const resolveWith = async (response: unknown) => {
    setIsSubmitting(true);
    try {
      await onResolve(response);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (request.method === "item/permissions/requestApproval") {
    return (
      <RequestShell
        title="Permissions requested"
        description={params.reason ?? `${agentLead} requested additional permissions.`}
        body={
          <pre className="overflow-x-auto rounded border border-[color:var(--border)] bg-foreground/[0.04] p-2 text-[11px] text-muted">
            {formatJson(params.permissions ?? request.params)}
          </pre>
        }
        footer={
          <ApprovalActionBar
            isDisabled={isSubmitting}
            positives={[
              {
                key: "turn",
                label: "Allow this turn",
                onPress: () =>
                  void resolveWith({
                    permissions: params.permissions ?? {},
                    scope: "turn",
                  }),
              },
              {
                key: "session",
                label: "Allow for session",
                onPress: () =>
                  void resolveWith({
                    permissions: params.permissions ?? {},
                    scope: "session",
                  }),
              },
            ]}
          />
        }
      />
    );
  }

  const isFileChange =
    request.method === "item/fileChange/requestApproval" || request.method === "applyPatchApproval";
  const title = isFileChange ? "File changes need approval" : "Command needs approval";
  const description =
    params.reason ?? `${agentLead} is waiting for approval before it can continue.`;

  const actions: RawAction[] =
    request.method === "item/commandExecution/requestApproval"
      ? (params.availableDecisions ?? ["accept", "acceptForSession", "decline", "cancel"]).map(
          (decision) => ({
            key: JSON.stringify(decision),
            label: getCommandDecisionLabel(decision),
            response: { decision },
            polarity: classifyDecision(decision),
          }),
        )
      : request.method === "item/fileChange/requestApproval"
        ? ["accept", "acceptForSession", "decline", "cancel"].map((decision) => ({
            key: decision,
            label: getCommandDecisionLabel(decision),
            response: { decision },
            polarity: classifyDecision(decision),
          }))
        : ["approved", "approved_for_session", "denied", "abort"].map((decision) => ({
            key: decision,
            label: getLegacyDecisionLabel(decision),
            response: { decision },
            polarity: classifyDecision(decision),
          }));

  // Cancel slot prefers the strongest negative ("cancel"/"abort") over a per-call "decline".
  const negatives = actions.filter((a) => a.polarity === "negative");
  const positives = actions.filter((a) => a.polarity === "positive");
  const cancelRaw = negatives.find((a) => isCancelOrAbort(a.key)) ?? negatives[0];
  const extraNegativesRaw = negatives.filter((a) => a !== cancelRaw);

  const details: DetailRow[] = [
    ...(params.command ? [{ label: "Command", value: params.command, mono: true }] : []),
    ...(params.cwd ? [{ label: "Directory", value: params.cwd, isPath: true }] : []),
    ...(params.grantRoot ? [{ label: "Grant root", value: params.grantRoot, isPath: true }] : []),
  ];

  return (
    <RequestShell
      title={title}
      description={description}
      details={details}
      body={
        params.permissions ? (
          <pre className="overflow-x-auto rounded border border-[color:var(--border)] bg-foreground/[0.04] p-2 text-[11px] text-muted">
            {formatJson(params.permissions)}
          </pre>
        ) : null
      }
      footer={
        <ApprovalActionBar
          isDisabled={isSubmitting}
          cancel={
            cancelRaw
              ? {
                  key: cancelRaw.key,
                  label: cancelRaw.label,
                  onPress: () => void resolveWith(cancelRaw.response),
                }
              : null
          }
          extraNegatives={extraNegativesRaw.map((a) => ({
            key: a.key,
            label: a.label,
            onPress: () => void resolveWith(a.response),
          }))}
          positives={positives.map((a) => ({
            key: a.key,
            label: a.label,
            onPress: () => void resolveWith(a.response),
          }))}
        />
      }
    />
  );
}

export function ThreadServerRequestPanel(props: {
  request: PendingThreadServerRequest;
  agentLabel?: string | undefined;
  onResolve: (input: {
    requestId: ThreadServerRequestId;
    method: string;
    response: unknown;
  }) => Promise<void>;
}) {
  const { request, agentLabel, onResolve } = props;
  const acpPermissionParams = parseAcpPermissionRequestParams(request.params);
  if (request.method === "requestPermission" && acpPermissionParams) {
    return (
      <AcpPermissionRequestCard
        params={acpPermissionParams}
        agentLabel={agentLabel}
        onResolve={(response) =>
          onResolve({
            requestId: request.requestId,
            method: request.method,
            response,
          })
        }
      />
    );
  }

  const userInputParams = parseUserInputRequestParams(request.params);
  if (request.method === "item/tool/requestUserInput" && userInputParams) {
    return (
      <UserInputRequestCard
        params={userInputParams}
        agentLabel={agentLabel}
        onResolve={(response) =>
          onResolve({
            requestId: request.requestId,
            method: request.method,
            response,
          })
        }
      />
    );
  }

  const mcpParams = parseMcpElicitationParams(request.params);
  if (request.method === "mcpServer/elicitation/request" && mcpParams) {
    return (
      <McpElicitationRequestCard
        params={mcpParams}
        onResolve={(response) =>
          onResolve({
            requestId: request.requestId,
            method: request.method,
            response,
          })
        }
      />
    );
  }

  return (
    <ApprovalRequestCard
      request={request}
      agentLabel={agentLabel}
      onResolve={(response) =>
        onResolve({
          requestId: request.requestId,
          method: request.method,
          response,
        })
      }
    />
  );
}
