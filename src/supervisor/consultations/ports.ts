import type { AvailableProvider, ConversationTurn, PermittedAttachment } from "@/shared/consultations";

/**
 * Side-effecting ports the coordinator depends on. Each has a real supervisor
 * binding and a deterministic test double, so the full lifecycle is testable
 * without spawning agent processes.
 */

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(): string;
}

/** Loads the parent thread's conversation + permitted attachments. */
export interface ParentThreadPort {
  loadMessages(threadId: string, limit: number): Promise<ConversationTurn[]>;
  loadAttachments?(threadId: string): Promise<PermittedAttachment[]>;
}

export interface ChildLaunchInput {
  parentThreadId: string;
  provider: string;
  model: string;
  prompt: string;
  title?: string;
  effort?: string;
}

export type ChildOutcomeStatus = "completed" | "failed" | "cancelled";

/**
 * The settled result of a child run. `rawOutput` is the child's concluding
 * text (parsed into a safe result elsewhere); `errorMessage` is internal and is
 * never surfaced to the user verbatim — the coordinator maps it to a safe code.
 */
export interface ChildOutcome {
  status: ChildOutcomeStatus;
  rawOutput: string;
  errorMessage?: string;
}

/** Launches/cancels/observes the real child thread/run the consultation backs. */
export interface ChildExecutionPort {
  launch(input: ChildLaunchInput): Promise<{ childThreadOrRunId: string }>;
  cancel(childThreadOrRunId: string): Promise<void>;
  awaitOutcome(childThreadOrRunId: string, signal?: AbortSignal): Promise<ChildOutcome>;
  /** Current child state for restart reconciliation: still running, or gone. */
  inspect(childThreadOrRunId: string): Promise<"active" | "gone">;
}

/** Produces a durable thread-summary string from messages (LLM-backed in prod). */
export interface SummaryGenerator {
  generate(input: { threadId: string; messages: ConversationTurn[] }): Promise<string>;
}

/** Live catalog of providers eligible to host a consultation child. */
export interface ProviderCatalogPort {
  list(): Promise<AvailableProvider[]>;
}
