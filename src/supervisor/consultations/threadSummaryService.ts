import type { ConversationTurn, ThreadSummaryRecord } from "@/shared/consultations";
import { contentHash } from "./hash";
import type { Clock, IdGenerator, SummaryGenerator } from "./ports";
import type { ConsultationRepository } from "./repository";

/**
 * Durable thread summaries (Part 7). A summary is regenerated ONLY when:
 *   - no valid summary exists yet, OR
 *   - meaningful messages were added after the previous source cursor, OR
 *   - the configured age threshold elapsed.
 * Unchanged summaries are reused, and an identical regenerated summary (same
 * content hash) is never persisted twice.
 */
export interface ThreadSummaryServiceDeps {
  repository: ConsultationRepository;
  generator: SummaryGenerator;
  clock: Clock;
  idGenerator: IdGenerator;
  maxAgeMs?: number;
}

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

export class ThreadSummaryService {
  private readonly maxAgeMs: number;

  constructor(private readonly deps: ThreadSummaryServiceDeps) {
    this.maxAgeMs = deps.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  async ensureSummary(input: {
    threadId: string;
    messages: ConversationTurn[];
    provider: string;
    model: string;
  }): Promise<ThreadSummaryRecord> {
    const { threadId, messages, provider, model } = input;
    const now = this.deps.clock.now();
    const existing = this.deps.repository.getLatestThreadSummary(threadId);
    const cursor = cursorFor(messages);

    if (existing && !this.needsRegeneration(existing, messages, now)) {
      return existing;
    }

    const summaryText = await this.deps.generator.generate({ threadId, messages });
    const hash = contentHash({ threadId, summary: summaryText });

    if (existing && existing.contentHash === hash) {
      return existing;
    }

    const record: ThreadSummaryRecord = {
      id: this.deps.idGenerator.next(),
      threadId,
      summary: summaryText,
      sourceCursor: cursor,
      provider,
      model,
      contentHash: hash,
      createdAt: now,
    };
    this.deps.repository.saveThreadSummary(record);
    return record;
  }

  private needsRegeneration(
    existing: ThreadSummaryRecord,
    messages: ConversationTurn[],
    now: string,
  ): boolean {
    if (hasMeaningfulMessagesAfterCursor(existing.sourceCursor, messages)) return true;
    const ageMs = Date.parse(now) - Date.parse(existing.createdAt);
    if (Number.isFinite(ageMs) && ageMs >= this.maxAgeMs) return true;
    return false;
  }
}

function isMeaningful(message: ConversationTurn): boolean {
  return (message.role === "user" || message.role === "assistant") && message.content.trim().length > 0;
}

function cursorFor(messages: ConversationTurn[]): string {
  const last = messages[messages.length - 1];
  if (last?.messageId) return last.messageId;
  return `count:${messages.length}`;
}

function hasMeaningfulMessagesAfterCursor(cursor: string, messages: ConversationTurn[]): boolean {
  const idx = messages.findIndex((message) => message.messageId === cursor);
  if (idx === -1) {
    return cursorFor(messages) !== cursor && messages.some(isMeaningful);
  }
  return messages.slice(idx + 1).some(isMeaningful);
}
