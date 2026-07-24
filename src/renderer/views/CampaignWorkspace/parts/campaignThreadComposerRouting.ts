import type { Thread } from "@/shared/contracts";
import { isMentionParseError, parseMention } from "@/shared/consultations";

export type CampaignComposerRouteResult =
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
 * Route a campaign-thread composer message to the Phase 4 consultation IPC.
 * Known @mentions pass through verbatim; plain text is wrapped with the thread's
 * default provider so the supervisor parses a standard consultation.
 */
export function routeCampaignComposerMessage(
  input: string,
  defaultProvider: string,
): CampaignComposerRouteResult {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "empty" };

  const parsed = parseMention(trimmed);
  if (!isMentionParseError(parsed)) {
    return { kind: "consultation", message: trimmed };
  }
  if (parsed.code === "unknown_mention") {
    return { kind: "consultation", message: `@${defaultProvider} ${trimmed}` };
  }
  return { kind: "parse_error", message: parsed.message };
}
