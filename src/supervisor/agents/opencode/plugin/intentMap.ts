import type { AgentEventIntent } from "@/shared/contracts";

// Mirrors the JS-side mapping in plugin.mjs. Kept as TS so the canonical event
// list is type-checked and easy to keep in sync from PR review.
export function opencodeIntentFor(eventName: string): AgentEventIntent | undefined {
  switch (eventName) {
    case "session.created":
      return "session.started";
    case "tool.execute.before":
      return "session.turn_started";
    case "permission.asked":
      return "session.needs_approval";
    case "session.idle":
      return "session.turn_finished";
    case "session.error":
      return "session.turn_errored";
    default:
      return undefined;
  }
}
