import type { ConsultationRecord, ConsultationStatus } from "./types";
import { isTerminalStatus } from "./types";

/**
 * The single source of truth for legal consultation status transitions.
 * Arbitrary status mutation is forbidden: callers must go through
 * {@link transition}, which throws on any edge not listed here.
 *
 *   queued           → building_context, failed, cancelled
 *   building_context → ready, failed, cancel_requested, cancelled
 *   ready            → running, failed, cancelled
 *   running          → awaiting_input, completed, failed, cancel_requested, cancelled
 *   awaiting_input   → running, completed, failed, cancel_requested, cancelled
 *   cancel_requested → cancelled, failed, completed
 *   completed        → (terminal)
 *   failed           → (terminal)
 *   cancelled        → (terminal)
 *
 * `cancel_requested → completed` covers the race where the child finishes just
 * as cancellation lands (a duplicate completion event); the coordinator decides
 * which wins, but the machine permits either terminal.
 */
export const VALID_TRANSITIONS: Record<ConsultationStatus, readonly ConsultationStatus[]> = {
  queued: ["building_context", "failed", "cancelled"],
  building_context: ["ready", "failed", "cancel_requested", "cancelled"],
  ready: ["running", "failed", "cancelled"],
  running: ["awaiting_input", "completed", "failed", "cancel_requested", "cancelled"],
  awaiting_input: ["running", "completed", "failed", "cancel_requested", "cancelled"],
  cancel_requested: ["cancelled", "failed", "completed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class IllegalTransitionError extends Error {
  readonly from: ConsultationStatus;
  readonly to: ConsultationStatus;

  constructor(from: ConsultationStatus, to: ConsultationStatus) {
    super(`Illegal consultation status transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: ConsultationStatus, to: ConsultationStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Return a new record moved to `to`, throwing {@link IllegalTransitionError}
 * when the edge is not permitted. Timestamp side-effects (startedAt/completedAt/
 * cancelledAt) are applied for the relevant terminal/running edges so callers
 * cannot forget them or set them out of band.
 */
export function transition(
  record: ConsultationRecord,
  to: ConsultationStatus,
  at: string = new Date().toISOString(),
): ConsultationRecord {
  if (!canTransition(record.status, to)) {
    throw new IllegalTransitionError(record.status, to);
  }
  const next: ConsultationRecord = { ...record, status: to };
  if (to === "running" && next.startedAt === null) {
    next.startedAt = at;
  }
  if (to === "completed" || to === "failed") {
    next.completedAt = at;
  }
  if (to === "cancelled") {
    next.cancelledAt = at;
    if (next.completedAt === null) next.completedAt = at;
  }
  return next;
}

/** Convenience guard used by the coordinator before doing terminal work. */
export function isSettled(record: ConsultationRecord): boolean {
  return isTerminalStatus(record.status);
}
