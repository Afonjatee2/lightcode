import { memo, useState } from "react";
import { Button } from "@heroui/react";
import { ShieldAlert } from "lucide-react";
import { readBridge } from "@/renderer/bridge";
import type { OpenRuntimeRequest } from "@/renderer/state/slices/runtimeEventSlice";

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

  return (
    <div className="my-2 flex gap-2 rounded-sm border border-warning-200/40 bg-warning-100/10 px-3 py-2 text-[length:var(--lc-chat-font-size-meta)]">
      <ShieldAlert className="size-3.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{request.payload.summary}</div>
        {request.payload.details ? (
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
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
});

const DEFAULT_OPTIONS = [
  { optionId: "allow", label: "Allow" },
  { optionId: "deny", label: "Deny" },
];

function formatDetails(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
