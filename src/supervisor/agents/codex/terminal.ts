import { findBestHint, type HintEntry, type TerminalStatusHint } from "../base";
import { detectRateLimitPrompt } from "./rateLimitPrompt";

// Bulletproof Codex detection patterns
// - Case-insensitive matching
// - Handles emoji prefixes (✨, etc.)
// - Handles various whitespace and formatting
// - Works across chunk boundaries

const CODEX_UPDATE_RE = /(?:[✨⚡]\s*)?update\s+available/i;
const CODEX_READY_RE = /openai\s+codex/i;
const CODEX_DIRECTORY_RE = /directory\s*:/i;
const CODEX_MODEL_RE = new RegExp("\\/model\\s+to\\s+change", "i");
const CODEX_PROMPT_RE = /(?:^|\n)›(?:\s|\u00a0).*/m;
const CODEX_TITLE_RE = /0;([^\r\n]+)/g;
const CODEX_QUESTION_HEADER_RE = /(?:^|\n)Question\s+\d+\/\d+\b/i;
const CODEX_QUESTION_CONTROL_RE =
  /enter\s+to\s+submit\s+answer|tab\s+to\s+add\s+notes|navigate\s+questions/i;

interface CodexHintEntry extends HintEntry {
  status: TerminalStatusHint["status"];
  attention: TerminalStatusHint["attention"];
}

const CODEX_STRONG_HINTS: CodexHintEntry[] = [
  { re: /enter\s+to\s+select/i, status: "needs_reply", attention: "needs_reply" },
  { re: /press enter to continue/i, status: "needs_reply", attention: "needs_reply" },
  { re: /\[y\/n\]|\(y\/N\)|allow\s+.*\?/i, status: "needs_approval", attention: "needs_approval" },
  { re: /•\s*working(?:\s*\(|…)?|esc\s+to\s+interrupt/i, status: "working", attention: "working" },
  {
    re: /use\s+\/skills\s+to\s+list\s+available\s+skills/i,
    status: "idle",
    attention: "none",
  },
];

const CODEX_IDLE_HINTS: CodexHintEntry[] = [
  { re: CODEX_PROMPT_RE, status: "idle", attention: "none" },
];

/**
 * Detect a Codex TUI "Update available!" interactive prompt from
 * ANSI-stripped PTY output.
 *
 * Bulletproof against:
 * - Emoji prefixes (✨, ⚡, etc.)
 * - Case variations
 * - Extra whitespace
 * - Partial matches across chunks
 */
export function detectCodexUpdatePrompt(text: string): boolean {
  // Normalize: remove emoji, normalize whitespace, make case-insensitive
  const normalized = text
    .replace(/[✨⚡💡]\s*/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return CODEX_UPDATE_RE.test(normalized);
}

export function detectCodexReadyForInitialPrompt(text: string): boolean {
  // Early exit if update prompt is detected (takes precedence)
  if (detectCodexUpdatePrompt(text)) {
    return false;
  }

  // Normalize for case-insensitive matching
  const normalized = text.toLowerCase().replace(/\s+/g, " ");

  // All three patterns must be present, but order doesn't matter
  const hasReady = CODEX_READY_RE.test(normalized);
  const hasDirectory = CODEX_DIRECTORY_RE.test(normalized);
  const hasModel = CODEX_MODEL_RE.test(normalized);

  return hasReady && hasDirectory && hasModel;
}

function findLastMatchIndex(text: string, re: RegExp): number {
  const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(text)) !== null) {
    lastIndex = match.index;
  }
  return lastIndex;
}

function findLastTitleIndex(text: string): number {
  return findLastMatchIndex(text, CODEX_TITLE_RE);
}

function detectCodexQuestionnaire(text: string): boolean {
  return CODEX_QUESTION_HEADER_RE.test(text) && CODEX_QUESTION_CONTROL_RE.test(text);
}

export function detectCodexTerminalStatus(text: string): TerminalStatusHint | null {
  const recent = text.slice(-1200);

  if (detectCodexUpdatePrompt(recent) || detectRateLimitPrompt(recent)) {
    return { status: "needs_reply", attention: "needs_reply", corroborated: true };
  }

  if (detectCodexReadyForInitialPrompt(recent) || detectCodexReadyForInitialPrompt(text)) {
    // Ready-for-initial-prompt requires three independent signals (ready + directory + model).
    return { status: "idle", attention: "none", corroborated: true };
  }

  if (detectCodexQuestionnaire(recent)) {
    return { status: "needs_reply", attention: "needs_reply", corroborated: true };
  }

  const strongHint = findBestHint(recent, CODEX_STRONG_HINTS);
  if (strongHint) {
    const lastWorkingIndex = findLastMatchIndex(
      recent,
      /•\s*working(?:\s*\(|…)?|esc\s+to\s+interrupt/i,
    );
    const lastTitleIndex = findLastTitleIndex(recent);
    const lastPromptIndex = findLastMatchIndex(recent, CODEX_PROMPT_RE);
    const hasIdleRedraw =
      strongHint.status === "working" &&
      lastTitleIndex > lastWorkingIndex &&
      lastPromptIndex > lastTitleIndex;

    if (!hasIdleRedraw) {
      return { status: strongHint.status, attention: strongHint.attention, corroborated: true };
    }
  }

  const idleHint = findBestHint(recent, CODEX_IDLE_HINTS);
  if (idleHint) {
    // Prompt cursor alone is a weak idle signal — not corroborated.
    return { status: idleHint.status, attention: idleHint.attention, corroborated: false };
  }

  return null;
}
