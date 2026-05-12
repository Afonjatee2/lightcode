import { CircleCheck, CircleSlash, Pause, Target } from "lucide-react";
import { Surface } from "@heroui/react";
import type { GoalItemPayload, GoalStatus } from "@/shared/contracts";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { chatMessageSurfaceClass } from "./chatMessageSurface";

interface GoalItemProps {
  item: RuntimeChatItem;
}

export function GoalItem({ item }: GoalItemProps) {
  const payload = getRuntimeItemPayload<GoalItemPayload>(item, "goal");
  if (!payload) return null;

  const Icon = iconForGoal(payload);
  const title = titleForGoal(payload);
  const details = detailsForGoal(payload);
  return (
    <Surface variant="transparent" className={chatMessageSurfaceClass}>
      <div className="flex min-w-0 items-start gap-2 text-[length:var(--lc-chat-font-size-meta)] leading-tight">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-foreground-muted" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="font-medium text-foreground">{title}</div>
          {payload.objective ? (
            <div className="min-w-0 whitespace-pre-wrap break-words text-foreground">
              {payload.objective}
            </div>
          ) : null}
          {details.length > 0 ? (
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-foreground-muted">
              {details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

function iconForGoal(payload: GoalItemPayload) {
  if (payload.action === "cleared") return CircleSlash;
  if (payload.status === "complete") return CircleCheck;
  if (payload.status === "paused") return Pause;
  return Target;
}

function titleForGoal(payload: GoalItemPayload): string {
  if (payload.action === "cleared") return "Goal cleared";
  if (payload.action === "viewed") return "Goal requested";
  if (payload.status === "complete") return "Goal completed";
  if (payload.status === "paused") return "Goal paused";
  if (payload.status === "budget_limited") return "Goal budget limit reached";
  if (payload.action === "set") return "Goal set";
  return "Goal updated";
}

function detailsForGoal(payload: GoalItemPayload): string[] {
  const details: string[] = [];
  if (payload.status && payload.status !== "active") details.push(statusLabel(payload.status));
  if (payload.tokenBudget != null)
    details.push(`${payload.tokensUsed ?? 0}/${payload.tokenBudget} tokens`);
  else if (payload.tokensUsed !== undefined && payload.tokensUsed > 0)
    details.push(`${payload.tokensUsed} tokens`);
  if (payload.timeUsedSeconds !== undefined && payload.timeUsedSeconds > 0) {
    details.push(formatDuration(payload.timeUsedSeconds));
  }
  return details;
}

function statusLabel(status: GoalStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "budget_limited":
      return "Budget limit reached";
    case "complete":
      return "Complete";
  }
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder > 0 ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
}
