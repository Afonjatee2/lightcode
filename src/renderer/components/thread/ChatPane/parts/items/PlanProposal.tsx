import { memo } from "react";
import { ListChecks } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { ItemMarkdown } from "./ItemMarkdown";
import { PathDisplay } from "@/renderer/components/common/PathDisplay";

interface PlanProposalProps {
  item: RuntimeChatItem;
}

/**
 * Inline render of an `ExitPlanMode` tool_use. Claude proposes a plan as a
 * markdown blob plus an optional saved-plan file path; the approval UI is
 * rendered separately by `ApprovalCard` from the matching `request.opened`.
 *
 * Streamed: the markdown body grows as `args.plan` arrives via input_json
 * deltas, so users see the plan compose in real time without a tool-call
 * accordion in the way.
 */
export const PlanProposal = memo(function PlanProposal({ item }: PlanProposalProps) {
  const payload = item.payload as ToolCallPayload | undefined;
  const args = readArgsObject(payload);
  const plan = readString(args, "plan");
  const planFilePath = readString(args, "planFilePath");
  const isStreaming = item.state !== "completed";

  if (!plan && !isStreaming) return null;

  return (
    <div className="my-1 flex flex-col gap-1">
      <div className="inline-flex items-center gap-1.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
        <ListChecks className="size-3 shrink-0" />
        <span>Proposed plan</span>
        {isStreaming ? <PixelLoader size="xxs" className="text-[color:var(--muted)]" /> : null}
      </div>
      {plan ? <ItemMarkdown text={plan} /> : null}
      {planFilePath ? (
        <div className="text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
          <PathDisplay path={planFilePath} />
        </div>
      ) : null}
    </div>
  );
});

export function isPlanProposalToolCall(item: RuntimeChatItem): boolean {
  if (item.type !== "tool_call") return false;
  const name = (item.payload as ToolCallPayload | undefined)?.name;
  return name === "ExitPlanMode";
}

function readArgsObject(payload: ToolCallPayload | undefined): Record<string, unknown> | undefined {
  const a = payload?.args;
  if (!a || typeof a !== "object" || Array.isArray(a)) return undefined;
  return a as Record<string, unknown>;
}

function readString(args: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!args) return undefined;
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
