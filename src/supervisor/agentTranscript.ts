/**
 * Recover the final assistant message from a CLI one-shot transcript.
 *
 * `codex exec` one-shots print the WHOLE session to stdout, not just the
 * answer: a `OpenAI Codex v<ver>` banner, a metadata block fenced by `--------`
 * rulers, then `user` / `codex` turn markers each followed by that turn's text
 * (the echoed prompt, tool-use narration, and finally the real reply). The
 * usable output is the FINAL `codex` turn — everything before it is wrapper.
 *
 * Used both as a defensive net in `cleanSpec` and as the fallback in the codex
 * one-shot runner when `--output-last-message` is unavailable.
 */

// Unambiguous transcript header. Requiring it (rather than guessing from
// `--------` rulers or the word "user") keeps a legitimate spec that merely
// contains dashes or role words from being mistaken for a transcript.
const CODEX_TRANSCRIPT_BANNER = /^OpenAI Codex v\d/;

/**
 * If `raw` is a codex exec transcript, return only the text after the last
 * `codex` turn marker (the final assistant message). Otherwise return `raw`
 * unchanged. Never returns an empty string for a non-empty transcript — if the
 * final turn is empty the input is returned as-is so callers don't lose data.
 */
export function extractFinalAgentMessage(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  if (!CODEX_TRANSCRIPT_BANNER.test(text)) return raw;

  const lines = text.split("\n");
  let lastAgentMarker = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === "codex") lastAgentMarker = i;
  }
  if (lastAgentMarker === -1) return raw;

  const finalMessage = lines.slice(lastAgentMarker + 1).join("\n").trim();
  return finalMessage.length > 0 ? finalMessage : raw;
}
