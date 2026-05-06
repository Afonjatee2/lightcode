import type { PromptSegment } from "@/shared/contracts";

const INLINE_FILE_TOKEN_REGEX = /(^|\s)@([^\s@]+)(?=\s|$)/g;

function pushTextSegment(segments: PromptSegment[], content: string): void {
  if (content.length === 0) {
    return;
  }
  const last = segments.at(-1);
  if (last?.kind === "text") {
    last.content += content;
    return;
  }
  segments.push({ kind: "text", content });
}

function pushTextBufferSegments(segments: PromptSegment[], content: string): void {
  if (content.length === 0) {
    return;
  }

  let cursor = 0;
  for (const match of content.matchAll(INLINE_FILE_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const path = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const mentionStart = matchIndex + prefix.length;
    const mentionEnd = mentionStart + 1 + path.length;

    if (mentionStart > cursor) {
      pushTextSegment(segments, content.slice(cursor, mentionStart));
    }
    if (path.length > 0) {
      segments.push({ kind: "file", path });
    }
    cursor = mentionEnd;
  }

  if (cursor < content.length) {
    pushTextSegment(segments, content.slice(cursor));
  }
}

/**
 * Walk a contentEditable container and produce structured prompt segments.
 * Text content becomes `{ kind: "text" }` segments, file mention chips
 * and inline `@path` tokens become `{ kind: "file", path }` segments.
 * Each adapter then formats these segments its own way (Claude: @path,
 * Codex: structured API, etc.).
 */
export function serializeToSegments(container: HTMLDivElement): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let textBuffer = "";

  function flushText() {
    if (textBuffer.length > 0) {
      pushTextBufferSegments(segments, textBuffer);
      textBuffer = "";
    }
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      textBuffer += node.textContent ?? "";
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.dataset.mentionPath) {
      flushText();
      segments.push({ kind: "file", path: el.dataset.mentionPath });
      return;
    }

    if (el.tagName === "BR") {
      textBuffer += "\n";
      return;
    }

    // Recurse into child nodes (e.g. divs created by Enter key)
    for (const child of el.childNodes) {
      walk(child);
    }

    // contentEditable creates <div> for new lines
    if (el.tagName === "DIV" && el !== container) {
      textBuffer += "\n";
    }
  }

  for (const child of container.childNodes) {
    walk(child);
  }

  flushText();
  return segments;
}

/** Flatten segments into a display string (for submitDisabled checks, etc.). */
export function flattenSegments(segments: PromptSegment[]): string {
  const rest = segments.filter((s) => s.kind !== "attachment");
  return rest
    .map((s) => (s.kind === "file" ? `@${s.path}` : s.content))
    .join("")
    .trim();
}

/**
 * Convenience: serialize contentEditable → flat prompt string.
 * Used for backward-compat and display purposes.
 */
export function serializeComposerContent(container: HTMLDivElement): string {
  return flattenSegments(serializeToSegments(container));
}
