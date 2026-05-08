import { memo, useState } from "react";
import { Button } from "@heroui/react";
import { ShieldAlert } from "lucide-react";
import { readBridge } from "@/renderer/bridge";
import type { OpenRuntimeRequest } from "@/renderer/state/slices/runtimeEventSlice";
import {
  asPermissionRequestDetails,
  type PermissionRequestDetails,
  type UserInputOption,
} from "@/shared/contracts";

interface ApprovalCardProps {
  threadId: string;
  request: OpenRuntimeRequest;
}

/**
 * Inline approval card rendered in the chat list when a `request.opened`
 * event is outstanding. Resolves via the same `resolveThreadServerRequest`
 * RPC the terminal-mode `ThreadServerRequestPanel` uses, so the supervisor
 * sees a single-source resolution path regardless of which UI rendered it.
 */
export const ApprovalCard = memo(function ApprovalCard({ threadId, request }: ApprovalCardProps) {
  const [resolving, setResolving] = useState(false);

  function decide(optionId: string) {
    if (resolving) return;
    setResolving(true);
    void readBridge()
      .resolveThreadServerRequest({
        threadId,
        requestId: request.requestId,
        method: "requestPermission",
        response: { optionId },
      })
      .catch((err) => {
        console.error("[chat] approval resolution failed", err);
        setResolving(false);
      });
  }

  const options = request.payload.options ?? DEFAULT_OPTIONS;
  const permissionDetails = asPermissionRequestDetails(request.payload.details);

  return (
    <div className="my-2 flex gap-2 rounded-sm border border-warning-200/40 bg-warning-100/10 px-3 py-2 text-[length:var(--lc-chat-font-size-meta)]">
      <ShieldAlert className="size-3.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{request.payload.summary}</div>
        {permissionDetails ? (
          <PermissionDetailsBlock details={permissionDetails} />
        ) : request.payload.details ? (
          <pre className="mt-1 max-h-32 overflow-y-auto rounded-sm bg-foreground/5 p-1.5 font-mono text-[11px] whitespace-pre-wrap break-words">
            {formatDetails(request.payload.details)}
          </pre>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <Button
              key={opt.optionId}
              size="sm"
              variant={opt.optionId === options[0]?.optionId ? "primary" : "ghost"}
              isDisabled={resolving}
              onPress={() => decide(opt.optionId)}
              {...(opt.description ? { title: opt.description } : {})}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
});

const DEFAULT_OPTIONS: UserInputOption[] = [
  { optionId: "allow", label: "Allow" },
  { optionId: "deny", label: "Deny" },
];

function PermissionDetailsBlock({ details }: { details: PermissionRequestDetails }) {
  const subject = details.description ?? formatInputSubject(details.input);
  const label = details.displayName ?? details.toolName;
  return (
    <div className="mt-1 space-y-1">
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

function formatInputSubject(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  if (typeof obj.command === "string") return obj.command;
  if (typeof obj.file_path === "string") return obj.file_path;
  if (typeof obj.path === "string") return obj.path;
  if (typeof obj.url === "string") return obj.url;
  return undefined;
}

function formatDetails(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
