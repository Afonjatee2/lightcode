import { findBestHint, type HintEntry, type TerminalStatusHint } from "../base";

interface ClaudeHintEntry extends HintEntry {
  status: TerminalStatusHint["status"];
  attention: TerminalStatusHint["attention"];
  planMode?: boolean;
  approvalPolicy?: string;
}

const CLAUDE_HINTS: ClaudeHintEntry[] = [
  {
    re: /Esc to cancel\s.*Tab to amend/i,
    status: "needs_approval",
    attention: "needs_approval",
    strong: true,
  },
  { re: /Enter to select/i, status: "needs_reply", attention: "needs_reply", strong: true },
  { re: /esc to interrupt/i, status: "working", attention: "working", strong: true },
  // Animated spinner (✻✶✽✢⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) + text + ellipsis — universal working indicator
  // NOTE: plain `*` excluded — Claude Code uses `*` as a selection marker in menus
  // Weak: spinners can linger as stale artifacts in the rolling buffer.
  { re: /[✻✶✽✢⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\S.*(?:…|\.\.\.)/i, status: "working", attention: "working" },
  // Plan approval prompt — "shift+tab to approve" / "ctrl-g to edit in Vim · <plan path>"
  { re: /shift.tab to approve/i, status: "needs_reply", attention: "needs_reply", strong: true },
  { re: /ctrl-g to edit/i, status: "needs_reply", attention: "needs_reply", strong: true },
  // "Exit plan mode?" confirmation — match the ❯ cursor on numbered choice at the end
  { re: /exit plan mode\?/i, status: "needs_reply", attention: "needs_reply", strong: true },
  {
    re: /\?\s+for shortcuts/i,
    status: "idle",
    attention: "none",
    approvalPolicy: "default",
    strong: true,
  },
  // Claude sometimes prints this immediately after returning to the prompt,
  // which can push the weak ❯ idle cursor outside the tail window.
  { re: /checking for updates/i, status: "idle", attention: "none", strong: true },
  { re: /plan mode on/i, status: "idle", attention: "none", planMode: true, strong: true },
  {
    re: /accept edits/i,
    status: "idle",
    attention: "none",
    approvalPolicy: "acceptEdits",
    strong: true,
  },
  {
    re: /bypass permissions/i,
    status: "idle",
    attention: "none",
    approvalPolicy: "bypassPermissions",
    strong: true,
  },
  // ❯ or > prompt cursor — universal idle/ready indicator
  // Exclude ❯ followed by a digit (numbered selection menu, not the input prompt)
  // Weak: can flash during partial TUI redraws.
  { re: /❯(?!\s*\d)|^\s*>(?!\s*\d)/, status: "idle", attention: "none" },
  // Type your message — idle indicator (fallback)
  // Weak: generic text that could appear in agent output.
  { re: /type your message/i, status: "idle", attention: "none" },
];

export function detectClaudeTerminalStatus(text: string): TerminalStatusHint | null {
  // Weak patterns (prompt cursor, spinner) are restricted to the tail of
  // the buffer. Large screen repaints can include historical ❯ prompt
  // markers from previous user messages deep in the chat scrollback;
  // without the tail restriction these stale markers win the "last match"
  // contest and cause false idle detections while the agent is working.
  const best = findBestHint(text, CLAUDE_HINTS, { weakTailWindow: 300 });
  if (!best) return null;

  const hint: TerminalStatusHint = {
    status: best.status,
    attention: best.attention,
  };

  if (best.planMode) {
    hint.planMode = true;
  }

  if (best.approvalPolicy) {
    hint.approvalPolicy = best.approvalPolicy;
  }

  // ── Dual-pattern corroboration ─────────────────────────────
  // Strong patterns are self-corroborating. Weak patterns need
  // a second independent signal of the same status in the buffer.
  if (best.strong) {
    hint.corroborated = true;
  } else {
    // Check if any other strong entry of the same status is also present
    hint.corroborated = CLAUDE_HINTS.some(
      (entry) =>
        entry.strong && entry.status === best.status && entry !== best && entry.re.test(text),
    );
  }

  // Detect model/effort changes from "Set model to ..." messages
  const modelEffort = detectClaudeModelEffort(text);
  if (modelEffort?.model) hint.model = modelEffort.model;
  if (modelEffort?.effort) hint.effort = modelEffort.effort;

  return hint;
}

// ── Model / effort detection from "Set model to …" messages ─────────

const CLAUDE_MODEL_MAP: [RegExp, string][] = [
  [/opus.*4\.7/i, "claude-opus-4-7[1m]"],
  [/opus/i, "claude-opus-4-6[1m]"],
  [/haiku/i, "haiku"],
  [/sonnet/i, "sonnet"],
];

const KNOWN_EFFORTS_MAP = new Map(
  ["low", "medium", "high", "xHigh", "max"].map((e) => [e.toLowerCase(), e]),
);

export function detectClaudeModelEffort(text: string): { model?: string; effort?: string } | null {
  const re = /Set model to (.+?)(?:\s+with (\w+) effort)?\s*$/gm;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    last = m;
  }
  if (!last) return null;

  const rawModel = last[1]?.replace(/\s*\(default\)\s*$/, "").trim();
  const rawEffort = last[2]?.toLowerCase();

  let model: string | undefined;
  if (rawModel) {
    for (const [pattern, id] of CLAUDE_MODEL_MAP) {
      if (pattern.test(rawModel)) {
        model = id;
        break;
      }
    }
  }

  const effort = rawEffort ? KNOWN_EFFORTS_MAP.get(rawEffort) : undefined;

  if (!model && !effort) return null;
  const result: { model?: string; effort?: string } = {};
  if (model) result.model = model;
  if (effort) result.effort = effort;
  return result;
}
