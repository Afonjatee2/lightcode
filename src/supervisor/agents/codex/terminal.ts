// Bulletproof Codex detection patterns for spawn orchestration (ready screen).
//
// Codex status layering:
//   L1 — CLI hooks (authoritative): UserPromptSubmit → working,
//        turn-complete → idle, approval events → needs_approval.
//   L2:
//     * OSC 9/777/99 — `handleOscNotification` in index.ts: idle + needs_approval
//       (notify-as-turn-done, plan-mode prompt, approval keywords). Hooks own
//       L1; OSC is fallback when not deferred.
//     * Terminal heuristics — this file: `detectCodexTerminalStatus` returns only
//       `working` (cheap TUI patterns). It never infers idle / needs_approval.
//
// Working detection uses a **trailing** window (`takeTail`) so a single long
// chunk / frame does not re-match “Working” / “esc” from finished turns above
// the live status row. L2 `detectTerminalStatus` is also fed per-PTY-chunk
// data in the pipeline (not merged 8k scrollback). And — critically — when the
// pipeline passes `context.idleStrippedTail` (the scrollback snapshot captured
// at the last idle transition), we reject any matched TUI line that is already
// in that snapshot: Codex bakes a static `● Working (Xs • esc to interrupt)`
// marker into scrollback for completed turns, so subsequent TUI repaints would
// otherwise re-flip the thread to `working` forever.

import { takeTail } from "@/shared/ansi";
import type { DetectTerminalStatusContext, TerminalStatusHint } from "../base";

/** Only the recent tail of a chunk: status row + co-located TUI, not full scrollback. */
const CODEX_WORKING_LOOKBACK_CHARS = 2048;

const CODEX_UPDATE_RE = /(?:[✨⚡]\s*)?update\s+available/i;
const CODEX_READY_RE = /openai\s+codex/i;
const CODEX_DIRECTORY_RE = /directory\s*:/i;
const CODEX_MODEL_RE = new RegExp("\\/model\\s+to\\s+change", "i");

/**
 * TUI lines that indicate Codex is actively working. Each regex captures the
 * full matched line (bounded by newlines on both sides) so the pipeline can
 * compare it byte-for-byte against the idle-time scrollback snapshot to reject
 * repaints of the just-finished turn.
 *
 * Order matters: most specific first. We return on the last successful match
 * so that a repaint containing both a stale line and a fresh one still picks
 * the fresh one when it appears later in the tail.
 */
const CODEX_WORKING_LINE_PATTERNS: RegExp[] = [
  /[^\r\n]*Working\s*\(\s*\d[^\r\n]*/g,
  /[^\r\n]*\besc to (?:interrupt|cancel)\b[^\r\n]*/gi,
  /[^\r\n]*\(esc to cancel\)[^\r\n]*/gi,
  /[^\r\n>]*\b(?:thinking|reasoning|planning)\b[^\r\n]*/gi,
];

/**
 * Detect a Codex TUI "Update available!" interactive prompt from
 * ANSI-stripped PTY output.
 */
export function detectCodexUpdatePrompt(text: string): boolean {
  const normalized = text
    .replace(/[✨⚡💡]\s*/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return CODEX_UPDATE_RE.test(normalized);
}

export function detectCodexReadyForInitialPrompt(text: string): boolean {
  if (detectCodexUpdatePrompt(text)) {
    return false;
  }

  const normalized = text.toLowerCase().replace(/\s+/g, " ");

  const hasReady = CODEX_READY_RE.test(normalized);
  const hasDirectory = CODEX_DIRECTORY_RE.test(normalized);
  const hasModel = CODEX_MODEL_RE.test(normalized);

  return hasReady && hasDirectory && hasModel;
}

/** Last (rightmost) match of any working-indicator pattern, or null. */
function findLatestWorkingLine(text: string): string | null {
  let best: { line: string; index: number } | null = null;
  for (const re of CODEX_WORKING_LINE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const line = m[0].trim();
      if (line.length === 0) continue;
      if (!best || m.index > best.index) {
        best = { line, index: m.index };
      }
    }
  }
  return best?.line ?? null;
}

/**
 * L2: infer **working** from an ANSI-stripped **PTY data chunk** (and its tail
 * window for large writes). Returns **only** `working` or `null` — never
 * `idle` / `needs_approval` (use OSC + hooks for those).
 *
 * When `context.idleStrippedTail` is supplied, any matched TUI line that is
 * also present in the snapshot is treated as a stale repaint and ignored.
 * A truly new turn writes a fresh `Working (0s …)` line not present in the
 * snapshot, so `idle → working` still fires promptly on fresh activity.
 */
export function detectCodexTerminalStatus(
  text: string,
  context?: DetectTerminalStatusContext,
): TerminalStatusHint | null {
  if (detectCodexUpdatePrompt(text) || detectCodexReadyForInitialPrompt(text)) {
    return null;
  }
  const recent = takeTail(text, CODEX_WORKING_LOOKBACK_CHARS);
  const line = findLatestWorkingLine(recent);
  if (!line) return null;
  const snapshot = context?.idleStrippedTail;
  if (snapshot && snapshot.length > 0 && snapshot.includes(line)) {
    return null;
  }
  return { status: "working", attention: "working", corroborated: false };
}
