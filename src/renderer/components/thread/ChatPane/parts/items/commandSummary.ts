/**
 * Derives a short, human-facing title for verbose shell wrappers (e.g. PowerShell
 * `-Command '…'`, leading `cd … &&`, or `-c "…"`), used in chat command rows.
 */

const MAX_TITLE_LEN = 120;

export type CommandIntentKind = "command" | "search" | "view";

export interface CommandIntentDisplay {
  title: string;
  kind: CommandIntentKind;
}

export function summarizeShellCommand(full: string): string {
  const s = full.trim().replace(/\r\n/g, "\n");
  if (!s) return "(command)";

  let work = s;
  for (let i = 0; i < 4; i++) {
    const fromPs = extractPowerShellQuotedCommand(work);
    if (fromPs) return finalizeTitle(fromPs);

    const fromAnyQuote = extractDashCQuoted(work);
    if (fromAnyQuote) return finalizeTitle(fromAnyQuote);

    const nextAmp = stripLeadingCdAnd(work);
    const nextSemi = stripLeadingCdSemicolon(work);
    const next = nextAmp !== work ? nextAmp : nextSemi !== work ? nextSemi : work;
    if (next === work) break;
    work = next;
  }

  const tail = lastAmpersandSegment(work);
  if (tail && tail.length < work.length) {
    const nested = extractPowerShellQuotedCommand(tail) ?? extractDashCQuoted(tail) ?? null;
    if (nested) return finalizeTitle(nested);
    if (!looksLikeBareExecutable(tail)) return finalizeTitle(tail);
  }

  return finalizeTitle(work);
}

function finalizeTitle(s: string): string {
  const t = collapseWhitespace(s.trim());
  if (t.length <= MAX_TITLE_LEN) return t;
  return `${t.slice(0, MAX_TITLE_LEN - 1)}…`;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ");
}

function extractPowerShellQuotedCommand(s: string): string | null {
  const re = /-Command\s+'((?:''|[^'])*)'/i;
  const m = re.exec(s);
  if (m?.[1] != null) return m[1]!.replace(/''/g, "'");
  const reDq = /-Command\s+"((?:\\.|[^"\\])*)"/i;
  const m2 = reDq.exec(s);
  if (m2?.[1] != null) return m2[1]!.replace(/\\"/g, '"').replace(/\\n/g, "\n");
  return null;
}

/** `-c '…'` / `-c "…"` (pwsh/bash). */
function extractDashCQuoted(s: string): string | null {
  const reSq = /(?:^|[\s;])-[A-Za-z]*c\s+'((?:\\.|[^'])*)'/i;
  const m = reSq.exec(s);
  if (m?.[1] != null) return m[1]!.replace(/\\'/g, "'");
  const reDq = /(?:^|[\s;])-[A-Za-z]*c\s+"((?:\\.|[^"\\])*)"/i;
  const m2 = reDq.exec(s);
  if (m2?.[1] != null) return m2[1]!.replace(/\\"/g, '"');
  return null;
}

function stripLeadingCdAnd(s: string): string {
  return s.replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|[^&]+?)\s*&&\s*/i, "").trim();
}

/** PowerShell: `cd "…"; command` */
function stripLeadingCdSemicolon(s: string): string {
  return s.replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|[^;]+?)\s*;\s*/i, "").trim();
}

function lastAmpersandSegment(s: string): string | null {
  const parts = s.split(/\s+&&\s+/);
  if (parts.length < 2) return null;
  return parts[parts.length - 1]!.trim();
}

/** Last `&&` segment is only a quoted exe — keep summarizing outer string. */
function looksLikeBareExecutable(segment: string): boolean {
  const t = segment.trim();
  return /^"[^"]+\.(exe|bat|cmd)"/i.test(t) && !/\s-Command\b/i.test(t) && !/\s-c\s/i.test(t);
}

const CHECK_SCRIPTS = new Set([
  "lint",
  "typecheck",
  "typecheck:compat",
  "test",
  "fmt",
  "format",
  "fmt:check",
]);

/**
 * One-line label for the command row: heuristic “intent” when we recognize the
 * tool, otherwise the shortened shell line. Payload has no separate title field today.
 */
export function humanIntentTitle(fullCommandLine: string): string {
  return commandIntentDisplay(fullCommandLine).title;
}

export function commandIntentDisplay(fullCommandLine: string): CommandIntentDisplay {
  const short = summarizeShellCommand(fullCommandLine);
  return intentFromSummarizedCommand(short) ?? { title: `Run: ${short}`, kind: "command" };
}

function intentFromSummarizedCommand(t: string): CommandIntentDisplay | null {
  const trimmed = t.trim();

  const gc = /^Get-Content\s+(.+)$/i.exec(trimmed);
  if (gc) {
    let p = gc[1]!.trim().replace(/^['"]|['"]$/g, "");
    p = (p.split(/\s+/)[0] ?? p).replace(/^['"]|['"]$/g, "");
    const base = p.split(/[/\\]/).pop() ?? p;
    return { title: `Read file: ${base}`, kind: "view" };
  }

  const typeCmd = /^type\s+(.+)$/i.exec(trimmed);
  if (typeCmd) {
    const p = typeCmd[1]!.trim().replace(/^['"]|['"]$/g, "");
    const base = p.split(/[/\\]/).pop() ?? p;
    return { title: `Read file: ${base}`, kind: "view" };
  }

  const sedView = parseSedView(trimmed);
  if (sedView) {
    return {
      title: `View lines ${sedView.lines}: ${sedView.path}`,
      kind: "view",
    };
  }

  const rgSearch = parseRipgrepSearch(trimmed);
  if (rgSearch) {
    return {
      title: rgSearch.scope
        ? `Search: "${rgSearch.pattern}" in ${rgSearch.scope}`
        : `Search: "${rgSearch.pattern}"`,
      kind: "search",
    };
  }

  const run = /^(pnpm|npm|yarn)\s+run\s+(\S+)/i.exec(trimmed);
  if (run) {
    const pm = run[1]!.toLowerCase();
    const script = run[2]!.replace(/['",]/g, "");
    if (CHECK_SCRIPTS.has(script)) {
      return { title: `Check: ${pm} run ${script}`, kind: "command" };
    }
    return { title: `Run: ${pm} run ${script}`, kind: "command" };
  }

  const exec = /^(pnpm|npm)\s+exec\s+(.+)$/i.exec(trimmed);
  if (exec) {
    const rest = exec[2]!.trim();
    if (/^oxfmt\b/i.test(rest)) return { title: "Format files", kind: "command" };
    const shortRest = rest.length > 72 ? `${rest.slice(0, 71)}…` : rest;
    return { title: `Run: ${shortRest}`, kind: "command" };
  }

  if (/^git\s+/i.test(trimmed)) {
    return {
      title: trimmed.length > 72 ? `Git: ${trimmed.slice(0, 71)}…` : `Git: ${trimmed}`,
      kind: "command",
    };
  }

  return null;
}

interface SedView {
  path: string;
  lines: string;
}

interface RipgrepSearch {
  pattern: string;
  scope: string | undefined;
}

function parseSedView(command: string): SedView | null {
  const words = splitShellWords(command);
  if (words.length < 3) return null;
  const executable = words[0]!.split(/[/\\]/).pop()?.toLowerCase();
  if (executable !== "sed" && executable !== "gsed") return null;

  let script: string | undefined;
  let path: string | undefined;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (word === "--") continue;
    if (word === "-e") {
      script = words[++i];
      continue;
    }
    if (word.startsWith("-")) continue;
    if (script === undefined) {
      script = word;
      continue;
    }
    path = word;
    break;
  }

  if (!script || !path || path === "-") return null;
  const range = /^(\d+)(?:,(\d+))?p$/.exec(script.trim());
  if (!range) return null;
  const start = range[1]!;
  const end = range[2];
  return { path, lines: end ? `${start}-${end}` : start };
}

function parseRipgrepSearch(command: string): RipgrepSearch | null {
  const words = splitShellWords(command);
  if (words.length < 2) return null;
  const executable = words[0]!.split(/[/\\]/).pop()?.toLowerCase();
  if (executable !== "rg" && executable !== "ripgrep") return null;

  let pattern: string | undefined;
  const paths: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (word === "--") {
      if (pattern === undefined) {
        pattern = words[++i];
      } else {
        paths.push(...words.slice(i + 1));
      }
      break;
    }
    if (word === "-e" || word === "--regexp") {
      pattern = words[++i];
      continue;
    }
    if (word.startsWith("--regexp=")) {
      pattern = word.slice("--regexp=".length);
      continue;
    }
    if (word === "-g" || word === "--glob" || word === "--type" || word === "-t") {
      i++;
      continue;
    }
    if (word.startsWith("-")) continue;
    if (pattern === undefined) {
      pattern = word;
      continue;
    }
    paths.push(word);
  }

  if (!pattern) return null;
  return { pattern, scope: paths.length > 0 ? paths.join(" ") : undefined };
}

function splitShellWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) words.push(current);
  return words;
}
