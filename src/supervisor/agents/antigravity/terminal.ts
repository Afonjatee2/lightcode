import { findBestHint, type HintEntry, type TerminalStatusHint } from "../base";

interface AntigravityHintEntry extends HintEntry {
  status: TerminalStatusHint["status"];
  attention: TerminalStatusHint["attention"];
}

const ANTIGRAVITY_STRONG: AntigravityHintEntry[] = [
  { re: /✋\s+Action Required/i, status: "needs_reply", attention: "needs_reply" },
  { re: /Enter to select/i, status: "needs_reply", attention: "needs_reply" },
  {
    re: /\[y\/n\]|\(y\/N\)|Allow\s+.*\?|Do you want to proceed|Continue\?/i,
    status: "needs_approval",
    attention: "needs_approval",
  },
  { re: /^[^\S\r\n]*[⣷⣯⣟⡿⢿⣻⣽⣾](?:\s|$)/m, status: "working", attention: "working" },
  { re: /✦\s+Working|⚙\s+Working/i, status: "working", attention: "working" },
  { re: /\(esc to cancel/i, status: "working", attention: "working" },
  { re: /◇\s+Ready/i, status: "idle", attention: "none" },
];

const ANTIGRAVITY_FALLBACK_IDLE: AntigravityHintEntry[] = [
  { re: /^\s*>\s*$/m, status: "idle", attention: "none" },
  { re: /\?\s+for shortcuts/i, status: "idle", attention: "none" },
];

export function detectAntigravityTerminalStatus(text: string): TerminalStatusHint | null {
  const tail = text.slice(-1200);

  const strong = findBestHint(tail, ANTIGRAVITY_STRONG);
  if (strong) {
    return { status: strong.status, attention: strong.attention, corroborated: true };
  }

  const fallback = findBestHint(tail, ANTIGRAVITY_FALLBACK_IDLE);
  if (!fallback) return null;
  const bothPresent = ANTIGRAVITY_FALLBACK_IDLE.every((entry) => entry.re.test(tail));
  return { status: fallback.status, attention: fallback.attention, corroborated: bothPresent };
}
