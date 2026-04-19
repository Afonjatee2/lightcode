import type { TerminalStatusHint } from "../base";

export const CURSOR_ATTENTION_RE = /Run this command\?|Suggested Plan|Waiting for approval/i;
export const CURSOR_WORKING_RE = /ctrl\+c to stop|\b(?:Generating|Reading|Globbing|Thinking)\b/i;
export const CURSOR_IDLE_RE = /Add a follow-up/i;

export function detectCursorTerminalStatus(text: string): TerminalStatusHint | null {
  const recent = text.slice(-1200);

  const entries: Array<{
    re: RegExp;
    status: TerminalStatusHint["status"];
    attention: TerminalStatusHint["attention"];
  }> = [
    { re: CURSOR_ATTENTION_RE, status: "needs_approval", attention: "needs_approval" },
    { re: CURSOR_WORKING_RE, status: "working", attention: "working" },
    { re: CURSOR_IDLE_RE, status: "idle", attention: "none" },
  ];

  let best:
    | {
        index: number;
        status: TerminalStatusHint["status"];
        attention: TerminalStatusHint["attention"];
      }
    | undefined;

  for (const entry of entries) {
    const globalRe = new RegExp(
      entry.re.source,
      entry.re.flags.includes("g") ? entry.re.flags : entry.re.flags + "g",
    );
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((match = globalRe.exec(recent)) !== null) {
      last = match;
    }
    if (last && (!best || last.index > best.index)) {
      best = { index: last.index, status: entry.status, attention: entry.attention };
    }
  }

  if (!best) return null;
  return { status: best.status, attention: best.attention, corroborated: true };
}
