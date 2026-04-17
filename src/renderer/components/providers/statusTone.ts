import type { Thread } from "@/shared/contracts";

export type StatusTone =
  | "inactive"
  | "active"
  | "working"
  | "finished"
  | "error"
  | "attention"
  | "done";

export function getStatusTone(thread: Pick<Thread, "status" | "done">): StatusTone {
  if (thread.status === "error") {
    return "error";
  }

  if (thread.status === "needs_approval" || thread.status === "needs_reply") {
    return "attention";
  }

  if (thread.status === "working") {
    return "working";
  }

  if (thread.status === "finished") {
    return "finished";
  }

  if (thread.status === "idle") {
    return "active";
  }

  if (thread.done) {
    return "done";
  }

  return "inactive";
}
