import { useState } from "react";
import { Button, ButtonGroup, Dropdown, Label } from "@heroui/react";
import { ChevronDown, HelpCircle, ShieldAlert } from "lucide-react";
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
  const { threadId, request, onResolve, onPlanApproved } = props;
  const [resolving, setResolving] = useState(false);

  function decide(optionIds: readonly string[]) {
    if (resolving) return;
    const primaryOptionId = optionIds[0];
    if (!primaryOptionId) return;
    setResolving(true);
    if (
      request.requestType !== "tool_user_input" &&
      outcomeForSelection(request.requestType, primaryOptionId) === "accepted" &&
      isPlanApprovalRequest(request)
    ) {
      onPlanApproved?.();
    }
    void onResolve({
      requestId: request.requestId,
      method: "requestPermission",
      response:
        optionIds.length === 1
          ? { optionId: primaryOptionId }
          : { optionId: primaryOptionId, optionIds },
    })
      .then(() => {
        useAppStore.getState().applyRuntimeEvent(threadId, {
          type: "request.resolved",
          threadId,
          requestId: request.requestId,
          outcome: outcomeForSelection(request.requestType, primaryOptionId),
        });
      })
      .catch((err) => {
        console.error("[chat] request resolution failed", err);
        setResolving(false);
      });
  }

  const options = request.payload.options ?? DEFAULT_APPROVAL_OPTIONS;
  const isQuestion = request.requestType === "tool_user_input";
  const Icon = isQuestion ? HelpCircle : ShieldAlert;
  const permissionDetails = asPermissionRequestDetails(request.payload.details);
  const detailText = !permissionDetails ? formatRawDetails(request.payload.details) : undefined;

  return (
    <ThreadDockSection className="!text-xs" placement="composer" collapsed={false}>
      <div className="flex items-start gap-2 px-2 pt-1.5 pb-1 leading-snug">
        <Icon
          className={`mt-0.5 size-3.5 shrink-0 ${isQuestion ? "text-foreground-muted" : "text-warning"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">{request.payload.summary}</div>
          {permissionDetails ? (
            <PermissionDetailsLine details={permissionDetails} />
          ) : detailText ? (
            <pre className="mt-0.5 max-h-24 overflow-y-auto rounded-sm bg-foreground/5 p-1 font-mono text-[11px] whitespace-pre-wrap break-words">
              {detailText}
            </pre>
          ) : null}
        </div>
      </div>

      {isQuestion ? (
        <QuestionRows
          options={options}
          isDisabled={resolving}
          onSubmit={decide}
          multiSelect={request.payload.multiSelect === true}
        />
      ) : (
        <ApprovalActions
          options={options}
          requestType={request.requestType}
          isDisabled={resolving}
          onSelect={(optionId) => decide([optionId])}
        />
      )}
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
        {options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            role="option"
            aria-selected="false"
            disabled={isDisabled}
            onClick={() => onSubmit([option.optionId])}
            className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs leading-tight transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <span className="min-w-0 flex-1 truncate text-foreground">{option.label}</span>
            {option.description ? (
              <span className="ms-auto truncate text-[color:var(--muted)]">
                {option.description}
              </span>
            ) : null}
          </button>
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
      {options.map((option) => (
        <button
          key={option.optionId}
          type="button"
          role="option"
          aria-selected={selected.has(option.optionId)}
          disabled={isDisabled}
          onClick={() => toggle(option.optionId)}
          className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs leading-tight transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none disabled:opacity-60 disabled:hover:bg-transparent"
        >
          <span className="mt-0.5 flex size-3 shrink-0 items-center justify-center rounded border border-foreground/30 text-[9px] text-foreground">
            {selected.has(option.optionId) ? "x" : ""}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">{option.label}</span>
          {option.description ? (
            <span className="ms-auto truncate text-[color:var(--muted)]">{option.description}</span>
          ) : null}
        </button>
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--border)] px-2 py-1.5">
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
            <ButtonGroup size="sm" variant="secondary">
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
              variant="secondary"
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
