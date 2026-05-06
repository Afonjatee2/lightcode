/**
 * Derives a short, human-facing title for verbose shell wrappers (e.g. PowerShell
 * `-Command '…'`, leading `cd … &&`, or `-c "…"`), used in chat command rows.
 */

const MAX_TITLE_LEN = 120;

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
  const reSq = /(?:^|[\s;])-c\s+'((?:\\.|[^'])*)'/i;
  const m = reSq.exec(s);
  if (m?.[1] != null) return m[1]!.replace(/\\'/g, "'");
  const reDq = /(?:^|[\s;])-c\s+"((?:\\.|[^"\\])*)"/i;
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
  const short = summarizeShellCommand(fullCommandLine);
  return intentFromSummarizedCommand(short) ?? short;
}

function intentFromSummarizedCommand(t: string): string | null {
  const trimmed = t.trim();

  const gc = /^Get-Content\s+(.+)$/i.exec(trimmed);
  if (gc) {
    let p = gc[1]!.trim().replace(/^['"]|['"]$/g, "");
    p = (p.split(/\s+/)[0] ?? p).replace(/^['"]|['"]$/g, "");
    const base = p.split(/[/\\]/).pop() ?? p;
    return `Read file: ${base}`;
  }

  const typeCmd = /^type\s+(.+)$/i.exec(trimmed);
  if (typeCmd) {
    const p = typeCmd[1]!.trim().replace(/^['"]|['"]$/g, "");
    const base = p.split(/[/\\]/).pop() ?? p;
    return `Read file: ${base}`;
  }

  const run = /^(pnpm|npm|yarn)\s+run\s+(\S+)/i.exec(trimmed);
  if (run) {
    const pm = run[1]!.toLowerCase();
    const script = run[2]!.replace(/['",]/g, "");
    if (CHECK_SCRIPTS.has(script)) {
      return `Check: ${pm} run ${script}`;
    }
    return `Run: ${pm} run ${script}`;
  }

  const exec = /^(pnpm|npm)\s+exec\s+(.+)$/i.exec(trimmed);
  if (exec) {
    const rest = exec[2]!.trim();
    if (/^oxfmt\b/i.test(rest)) return "Format files";
    const shortRest = rest.length > 72 ? `${rest.slice(0, 71)}…` : rest;
    return `Run: ${shortRest}`;
  }

  if (/^git\s+/i.test(trimmed)) {
    return trimmed.length > 72 ? `Git: ${trimmed.slice(0, 71)}…` : `Git: ${trimmed}`;
  }

  return null;
}
