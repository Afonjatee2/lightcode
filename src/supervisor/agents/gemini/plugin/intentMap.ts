import type { AgentEventIntent } from "@/shared/contracts";

export interface GeminiHookPayload {
  hook_event_name?: string;
  notification_type?: string;
  type?: string;
  message?: string;
}

function notificationNeedsApproval(payload: GeminiHookPayload | undefined): boolean {
  const notificationType = `${payload?.notification_type ?? payload?.type ?? ""}`.toLowerCase();
  const message = `${payload?.message ?? ""}`.toLowerCase();
  return (
    notificationType === "toolpermission" ||
    notificationType.includes("permission") ||
    message.includes("permission") ||
    message.includes("approval")
  );
}

export function geminiIntentFor(
  eventName: string,
  payload: GeminiHookPayload | undefined,
): AgentEventIntent | undefined {
  const name = payload?.hook_event_name ?? eventName;
  switch (name) {
    case "SessionStart":
      return "session.started";
    case "BeforeAgent":
    case "BeforeModel":
    case "BeforeTool":
    case "AfterTool":
      return "session.turn_started";
    case "AfterAgent":
      return "session.turn_finished";
    case "Notification":
      return notificationNeedsApproval(payload) ? "session.needs_approval" : undefined;
    default:
      return undefined;
  }
}
