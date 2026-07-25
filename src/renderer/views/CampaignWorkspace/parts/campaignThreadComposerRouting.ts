import type { Thread } from "@/shared/contracts";
import {
  isMentionParseError,
  parseMention,
  type ParseMentionOptions,
} from "@/shared/consultations";

export type CampaignComposerRouteResult =
  | { kind: "chat"; message: string }
  | { kind: "consultation"; message: string }
  | { kind: "parse_error"; message: string }
  | { kind: "empty" };

/**
 * Resolve the durable parent thread for a campaign workspace project.
 * Campaign projects are created with a single initial GUI thread; when several
 * exist we pick the oldest non-archived thread.
 */
export function resolvePrimaryCampaignThread(threads: Thread[]): Thread | undefined {
  const active = threads.filter((thread) => !thread.archived);
  if (active.length === 0) return undefined;
  return [...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

/**
 * Route a campaign-thread composer message. Plain prose goes to the active
 * thread as a normal GUI turn; known @mentions route through consultations.
 */
export function routeCampaignComposerMessage(
  input: string,
  _defaultProvider: string,
  options?: ParseMentionOptions,
): CampaignComposerRouteResult {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "empty" };

  const parsed = parseMention(trimmed, options);
  if (!isMentionParseError(parsed)) {
    return { kind: "consultation", message: trimmed };
  }
  if (parsed.code === "unknown_mention") {
    // Plain prose is a normal agent turn; text that *starts* with an @word is
    // a mistyped mention — surface it instead of sending a doomed turn.
    if (trimmed.startsWith("@")) {
      return { kind: "parse_error", message: parsed.message };
    }
    return { kind: "chat", message: trimmed };
  }
  return { kind: "parse_error", message: parsed.message };
}
