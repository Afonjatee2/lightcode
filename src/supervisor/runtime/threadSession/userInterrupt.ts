import type { SessionRuntime } from "../sessionTypes";

/**
 * Grace window before the local fallback commits to `idle` after detecting a
 * user-interrupt keystroke. Long enough for a legitimate
 * `PostToolUseFailure { is_interrupt: true }` hook to land and take over,
 * short enough that the UI doesn't feel stuck.
 */
export const USER_INTERRUPT_RECOVERY_GRACE_MS = 1200;

/**
 * True iff the user keystroke payload represents an interrupt intent the
 * user expects to unblock the agent. Matches:
 *   - `\x03`   (Ctrl+C)     — always an interrupt
 *   - exactly `\x1b` (Esc)  — standalone Esc press
 * Does NOT match CSI sequences like `\x1b[A` (arrows) or `\x1bO...` (fn keys),
 * or alt+<char> (`\x1b<letter>`), so menu navigation inside the permission
 * dialog does not trigger the fallback.
 */
export function isUserInterruptKeystroke(data: string): boolean {
  if (data.includes("\x03")) return true;
  if (data === "\x1b") return true;
  return false;
}

/**
 * True iff the current thread status is "busy" from the user's point of view —
 * i.e. pressing Esc / Ctrl+C in this state is expected to unblock the UI.
 */
export function isInterruptibleBusyStatus(status: SessionRuntime["status"]): boolean {
  return status === "working" || status === "needs_approval" || status === "needs_reply";
}
