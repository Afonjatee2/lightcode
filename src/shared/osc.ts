/**
 * OSC (Operating System Command) escape sequence parser.
 *
 * Extracts structured notifications from raw PTY data before ANSI stripping.
 * Agents (or their hook scripts) can emit these standard terminal escape
 * sequences to signal state changes without relying on fragile TUI output parsing.
 *
 * Supported protocols:
 * - OSC 0/1/2 — window/icon title: \x1b]0;<text>\x07 (also 1, 2 same shape)
 * - OSC 9   — simple notification: \x1b]9;<text>\x07
 * - OSC 777 — RXVT notify:         \x1b]777;notify;<title>;<body>\x07
 * - OSC 99  — Kitty notify:         \x1b]99;...;p=<key>:<value>\x1b\\
 */

export interface OscNotification {
  /** Which OSC code was used. */
  code: 9 | 777 | 99;
  /** Notification title (empty string for OSC 9). */
  title: string;
  /** Notification body text. */
  body: string;
  /** Parsed JSON body when the body is valid JSON, undefined otherwise. */
  payload: Record<string, unknown> | undefined;
}

export interface OscTitle {
  /** 0 = icon + window title, 1 = icon, 2 = window title. */
  code: 0 | 1 | 2;
  /** The title text (everything after `<code>;` up to the terminator). */
  text: string;
}

export interface OscExtractionResult {
  /** The raw data with all extracted OSC sequences removed. */
  cleaned: string;
  /** Extracted notifications (empty array if none found). */
  notifications: OscNotification[];
  /** Extracted window/icon titles (empty array if none found). */
  titles: OscTitle[];
}

// Combined regex to extract notifications (9 / 777 / 99) and titles (0 / 1 / 2)
// in a single pass. Leftmost alternative wins; `9;` vs `99;` / `777;` don't
// conflict (they diverge after the first digit) and neither does `(0|1|2);`
// with anything else (single digit followed by `;`, so `133`/`1337`/`11` all
// skip it).
const OSC_EVENT_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  `\\x1b\\](?:` +
    `9;([^\\x07\\x1b]*)(?:\\x07|\\x1b\\\\)` + // OSC 9: group 1 = text
    `|` +
    `777;notify;([^;\\x07\\x1b]*);([^\\x07\\x1b]*)(?:\\x07|\\x1b\\\\)` + // OSC 777: group 2 = title, group 3 = body
    `|` +
    `99;([^\\x07\\x1b]*)(?:\\x07|\\x1b\\\\)` + // OSC 99: group 4 = params
    `|` +
    `(0|1|2);([^\\x07\\x1b]*)(?:\\x07|\\x1b\\\\)` + // OSC 0/1/2: group 5 = code, group 6 = title text
    `)`,
  "g",
);

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not valid JSON — skip.
  }
  return undefined;
}

/**
 * Parse a Kitty OSC 99 parameter string into key-value pairs.
 * Format: `i=<id>;e=<end>;d=<done>;p=<type>:<value>`
 * The `p=` parameter contains the payload (title, subtitle, or body).
 */
function parseKittyParams(raw: string): { title: string; body: string } | null {
  const parts = raw.split(";");
  let payloadType = "";
  let payloadValue = "";

  for (const part of parts) {
    if (part.startsWith("p=")) {
      const colonIdx = part.indexOf(":", 2);
      if (colonIdx >= 0) {
        payloadType = part.slice(2, colonIdx);
        payloadValue = part.slice(colonIdx + 1);
      } else {
        payloadValue = part.slice(2);
      }
    }
  }

  if (!payloadValue) {
    return null;
  }

  // Kitty sends title/body/subtitle as separate OSC 99 sequences.
  // We expose whatever we got in this single sequence.
  if (payloadType === "title") {
    return { title: payloadValue, body: "" };
  }
  if (payloadType === "body") {
    return { title: "", body: payloadValue };
  }
  // subtitle or untyped — treat as body
  return { title: "", body: payloadValue };
}

/**
 * Extract OSC notification and title sequences from raw PTY data.
 *
 * Returns the cleaned data (with extracted sequences removed) and
 * arrays of parsed notifications and titles. The cleaned data can then be
 * passed to `stripAnsiPreservingLayout` for normal status detection.
 */
export function extractOscEvents(data: string): OscExtractionResult {
  const notifications: OscNotification[] = [];
  const titles: OscTitle[] = [];

  // Reset lastIndex for global regex reuse across calls
  OSC_EVENT_RE.lastIndex = 0;

  const cleaned = data.replace(OSC_EVENT_RE, (_match, g1, g2, g3, g4, g5, g6) => {
    if (g1 !== undefined) {
      // OSC 9 — simple notification
      const body = g1 as string;
      notifications.push({
        code: 9,
        title: "",
        body,
        payload: tryParseJson(body),
      });
    } else if (g2 !== undefined) {
      // OSC 777 — RXVT notify
      const title = g2 as string;
      const body = (g3 as string | undefined) ?? "";
      notifications.push({
        code: 777,
        title,
        body,
        payload: tryParseJson(body),
      });
    } else if (g4 !== undefined) {
      // OSC 99 — Kitty notification
      const parsed = parseKittyParams(g4 as string);
      if (parsed) {
        notifications.push({
          code: 99,
          title: parsed.title,
          body: parsed.body,
          payload: tryParseJson(parsed.body),
        });
      }
    } else if (g5 !== undefined) {
      // OSC 0/1/2 — window/icon title
      const code = Number(g5) as 0 | 1 | 2;
      const text = (g6 as string | undefined) ?? "";
      titles.push({ code, text });
    }
    // Remove the sequence from the output
    return "";
  });

  return { cleaned, notifications, titles };
}

/** Defensive cap so a pathological PTY line cannot grow memory without bound. */
const MAX_PTY_OSC_CARRY = 64 * 1024;

/**
 * If `cleaned` ends with a handled OSC (0 / 1 / 2 / 9 / 777 / 99) that has no
 * ST/BEL terminator yet, split it off for the next PTY read — sequences are
 * often split across `node-pty` chunks (notably on Windows / ConPTY).
 */
function takeTrailingIncompleteOsc(s: string): { head: string; carry: string } {
  const last = s.lastIndexOf("\x1b]");
  if (last < 0) return { head: s, carry: "" };
  const tail = s.slice(last);
  const afterIntroducer = tail.slice(2); // drop the leading ESC + ']'
  if (!/^(?:0;|1;|2;|9;|777;notify;|99;)/.test(afterIntroducer)) return { head: s, carry: "" };
  if (tail.includes("\x07") || tail.includes("\x1b\\")) return { head: s, carry: "" };
  return { head: s.slice(0, last), carry: tail };
}

/**
 * Reassemble split OSC sequences across multiple PTY reads, then extract the
 * same event lists as {@link extractOscEvents}. Pass the previous return's
 * `carryOut` as the next `carryIn`.
 */
export function extractOscEventsFromPtyStream(
  carryIn: string | undefined,
  chunk: string,
): {
  carryOut: string;
  notifications: OscNotification[];
  titles: OscTitle[];
  cleaned: string;
} {
  let carry = carryIn ?? "";
  if (carry.length > MAX_PTY_OSC_CARRY) {
    carry = "";
  }
  const combined = carry + chunk;
  const { cleaned, notifications, titles } = extractOscEvents(combined);
  const { head, carry: tailCarry } = takeTrailingIncompleteOsc(cleaned);
  return { carryOut: tailCarry, notifications, titles, cleaned: head };
}
