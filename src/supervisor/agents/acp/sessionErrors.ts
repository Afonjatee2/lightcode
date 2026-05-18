import { RequestError } from "@agentclientprotocol/sdk";
import type { RuntimeEvent } from "@/shared/contracts";
import {
  createContextUsageEvent,
  readNonNegativeInteger,
  usageFromTokenCounts,
} from "../contextUsage";

export function createAcpPromptUsageEvent(
  threadId: string,
  usage: unknown,
): RuntimeEvent | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const obj = usage as Record<string, unknown>;
  return createContextUsageEvent(
    threadId,
    usageFromTokenCounts({
      usedTokens: readNonNegativeInteger(obj.totalTokens),
      inputTokens: readNonNegativeInteger(obj.inputTokens),
      outputTokens: readNonNegativeInteger(obj.outputTokens),
      thoughtTokens: readNonNegativeInteger(obj.thoughtTokens),
      cachedReadTokens: readNonNegativeInteger(obj.cachedReadTokens),
      cachedWriteTokens: readNonNegativeInteger(obj.cachedWriteTokens),
    }),
  );
}

/**
 * Replace the raw JSON-RPC error from `session/load` with a message the
 * renderer can show verbatim. Provider-agnostic on purpose: the same code
 * path triggers whenever any ACP agent rejects a `session/load` call (lost,
 * rotated, or never-persisted sessionId).
 */
export function rewriteLoadSessionError(error: unknown, _sessionId: string): Error {
  const detail = extractLoadSessionDetail(error);
  const message = detail.notFound
    ? "This conversation can't be resumed — the agent no longer recognizes this session. Start a new thread to continue."
    : `This conversation can't be resumed: ${detail.message ?? (error instanceof Error ? error.message : String(error))}. Start a new thread to continue.`;
  return Object.assign(new Error(message), { cause: error });
}

function extractLoadSessionDetail(error: unknown): { message?: string; notFound: boolean } {
  let message: string | undefined;
  let notFound = false;
  if (error instanceof RequestError) {
    message = error.message;
    const data = error.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") {
      message = data.message;
      if (/not\s+found/i.test(data.message)) notFound = true;
    }
  } else if (error instanceof Error) {
    message = error.message;
    if (/session.*not\s+found/i.test(error.message)) notFound = true;
  }
  return notFound
    ? { ...(message ? { message } : {}), notFound: true }
    : { ...(message ? { message } : {}), notFound: false };
}

export const INTERRUPT_ACK_TEXT_TAIL_LIMIT = 512;
const USER_INTERRUPT_ACK_RE = /\boperation cancelled by user\b/i;

export function appendInterruptAckTextTail(current: string, next: string): string {
  if (next.length === 0) return current;
  const combined = current.length === 0 ? next : current + next;
  return combined.slice(-INTERRUPT_ACK_TEXT_TAIL_LIMIT);
}

export function normalizeAcpStopReason(
  stopReason: string,
  input: { interruptRequested: boolean; recentAgentText?: string },
): string {
  if (
    stopReason === "end_turn" &&
    input.interruptRequested &&
    input.recentAgentText &&
    USER_INTERRUPT_ACK_RE.test(input.recentAgentText)
  ) {
    return "cancelled";
  }
  return stopReason;
}
