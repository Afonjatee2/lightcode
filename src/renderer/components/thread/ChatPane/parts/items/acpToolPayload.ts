/**
 * ACP-shaped tool-call payload helpers.
 *
 * ACP-speaking adapters (Copilot, generic ACP) carry the tool's request and
 * response on the chat item payload as `{ name, args, status, result }`. After
 * `canonicalMapping` extracts the canonical type-specific fields (`command`,
 * `path`, `query`), the rest of the request/response stays around so the
 * accordion body can show what was actually sent and what came back.
 *
 * These helpers read those auxiliary fields tolerantly — codex-shaped rows
 * lack them and that's fine.
 */

export interface AcpToolResult {
  /** Short preview text. */
  content?: unknown;
  /** Full output (may be larger than `content`). */
  detailedContent?: unknown;
  /** Typed content blocks (mostly used by web_search). */
  contents?: Array<{ type?: string; text?: unknown } | undefined>;
}

import type { ViewportLanguage } from "./languageDetect";

/** A rendered tool-call section. `language` selects how the viewport highlights the body. */
export interface ExtractedPart {
  text: string;
  language: ViewportLanguage;
}

/** Pull a string from `args[key]` when args is an object (not a string blob). */
export function readAcpStringField(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const args = (payload as Record<string, unknown>).args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const v = (args as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Serialize the tool's `result` field for accordion bodies, returning the
 * formatted text and whether it parses as JSON (so the renderer can apply
 * syntax highlighting). Prefers `detailedContent` over `content` (full vs.
 * preview); falls back to JSON for objects without those keys.
 */
export function extractAcpResultPart(payload: unknown): ExtractedPart {
  if (!payload || typeof payload !== "object") return emptyPart();
  const result = (payload as Record<string, unknown>).result;
  if (result === undefined || result === null) return emptyPart();
  if (typeof result === "string") return asPart(prettyIfJson(result));
  if (typeof result !== "object") return { text: String(result), language: "plain" };

  const r = result as AcpToolResult;
  if (typeof r.detailedContent === "string" && r.detailedContent.length > 0)
    return asPart(prettyIfJson(r.detailedContent));
  if (typeof r.content === "string" && r.content.length > 0) return asPart(prettyIfJson(r.content));
  if (Array.isArray(r.contents)) {
    const parts = r.contents
      .map((c) => (c && typeof c.text === "string" ? prettyIfJson(c.text) : ""))
      .filter((t) => t.length > 0);
    if (parts.length > 0) {
      const joined = parts.join("\n\n");
      return { text: joined, language: parts.every(isJsonText) ? "json" : "plain" };
    }
  }
  return { text: safeJson(result), language: "json" };
}

/** Serialize `args` for accordion bodies. String args (apply_patch) pass through; objects become pretty-printed JSON. */
export function extractAcpArgsPart(payload: unknown): ExtractedPart {
  if (!payload || typeof payload !== "object") return emptyPart();
  const args = (payload as Record<string, unknown>).args;
  if (args === undefined || args === null) return emptyPart();
  if (typeof args === "string") return asPart(prettyIfJson(args));
  return { text: safeJson(args), language: "json" };
}

/** Back-compat: text-only accessors for callers that don't need the language. */
export function extractAcpResultText(payload: unknown): string {
  return extractAcpResultPart(payload).text;
}

export function extractAcpArgsText(payload: unknown): string {
  return extractAcpArgsPart(payload).text;
}

function emptyPart(): ExtractedPart {
  return { text: "", language: "plain" };
}

function asPart(text: string): ExtractedPart {
  return { text, language: isJsonText(text) ? "json" : "plain" };
}

function isJsonText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  const head = trimmed[0];
  const tail = trimmed[trimmed.length - 1];
  if (!((head === "{" && tail === "}") || (head === "[" && tail === "]"))) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * If `text` parses as a JSON object/array, return a 2-space indented version;
 * otherwise return the input unchanged. Bare strings/numbers/booleans are not
 * worth re-formatting (the parsed value loses surrounding context), so we only
 * reformat when the trimmed text looks like a structured JSON literal.
 */
function prettyIfJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return text;
  const head = trimmed[0];
  const tail = trimmed[trimmed.length - 1];
  if (!((head === "{" && tail === "}") || (head === "[" && tail === "]"))) return text;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") return JSON.stringify(parsed, null, 2);
  } catch {
    // not JSON — fall through
  }
  return text;
}
