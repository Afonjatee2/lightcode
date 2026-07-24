import {
  FixtureCampaignContextProvider,
  isTerminalStatus,
  type AvailableProvider,
  type CampaignContextProvider,
  type ConsultationRecord,
  type ConsultationResultRecord,
  type ConsultationStatus,
  type ContextPacketRecord,
  type ConversationTurn,
  type PanelMembershipRecord,
  type PermittedAttachment,
  type ThreadSummaryRecord,
} from "@/shared/consultations";
import { ContextPacketBuilder } from "./contextPacketBuilder";
import { ConsultationCoordinator, type CoordinatorDeps } from "./coordinator";
import type {
  ChildExecutionPort,
  ChildLaunchInput,
  ChildOutcome,
  Clock,
  IdGenerator,
  ParentThreadPort,
  ProviderCatalogPort,
  SummaryGenerator,
} from "./ports";
import type { ConsultationRepository } from "./repository";
import { ThreadSummaryService } from "./threadSummaryService";

/**
 * Deterministic test doubles + a harness for exercising the coordinator without
 * spawning agent processes. Exported so Worker 2's renderer lifecycle tests can
 * drive the same backend with a fixture child agent.
 */

export class DeterministicClock implements Clock {
  private current: number;

  constructor(start: string = "2026-07-22T00:00:00.000Z") {
    this.current = Date.parse(start);
  }

  now(): string {
    return new Date(this.current).toISOString();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix: string = "id") {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(6, "0")}`;
  }
}

/** A well-formed child output the result parser can fully extract. */
export const WELL_FORMED_CHILD_OUTPUT = [
  "## Summary",
  "Spend is pacing ahead of plan; Meta is driving CPA.",
  "## Key Findings",
  "- Pacing is ahead of plan",
  "- Meta CPA is above target",
  "## Evidence",
  "- spend_vs_plan calculation",
  "## Assumptions",
  "- Plan figures are current",
  "## Uncertainties",
  "- Google sync is stale",
  "## Recommendations",
  "- Rebalance budget toward Google",
  "## Suggested Proposal Inputs",
  "```json",
  '[{"title":"Shift 10% to Google","rationale":"Better CPA","scopeType":"channel","scopeId":"google","suggestedChange":"move 10%"}]',
  "```",
].join("\n");

interface FixtureChildState {
  outcome: ChildOutcome;
  cancelled: boolean;
  settled: boolean;
  delayMs: number;
}

/**
 * Simulates child runs. By default each launched child completes with
 * {@link WELL_FORMED_CHILD_OUTPUT}; queue per-launch overrides to simulate
 * launch failure, execution failure, hangs, or cancellation.
 */
export class FixtureChildExecution implements ChildExecutionPort {
  private readonly states = new Map<string, FixtureChildState>();
  private readonly inspectOverrides = new Map<string, "active" | "gone">();
  private readonly queue: Array<Partial<FixtureChildState> & { failLaunch?: Error }> = [];
  private idCounter = 0;
  launchCount = 0;
  cancelCount = 0;
  defaultOutcome: ChildOutcome = { status: "completed", rawOutput: WELL_FORMED_CHILD_OUTPUT };

  /** Queue a behaviour for the NEXT launch (FIFO). */
  enqueueNext(behaviour: Partial<FixtureChildState> & { failLaunch?: Error }): void {
    this.queue.push(behaviour);
  }

  setInspect(childThreadOrRunId: string, state: "active" | "gone"): void {
    this.inspectOverrides.set(childThreadOrRunId, state);
  }

  async launch(input: ChildLaunchInput): Promise<{ childThreadOrRunId: string }> {
    this.launchCount += 1;
    const behaviour = this.queue.shift();
    if (behaviour?.failLaunch) throw behaviour.failLaunch;
    this.idCounter += 1;
    const id = `child-${String(this.idCounter).padStart(6, "0")}`;
    this.states.set(id, {
      outcome: behaviour?.outcome ?? this.defaultOutcome,
      cancelled: false,
      settled: false,
      delayMs: behaviour?.delayMs ?? 0,
    });
    void input;
    return { childThreadOrRunId: id };
  }

  async cancel(childThreadOrRunId: string): Promise<void> {
    this.cancelCount += 1;
    const state = this.states.get(childThreadOrRunId);
    if (state) state.cancelled = true;
  }

  async awaitOutcome(childThreadOrRunId: string, signal?: AbortSignal): Promise<ChildOutcome> {
    const state = this.states.get(childThreadOrRunId);
    if (!state) return { status: "failed", rawOutput: "", errorMessage: "unknown child" };
    if (state.delayMs > 0) {
      const aborted = await abortableSleep(state.delayMs, signal);
      if (aborted || state.cancelled || signal?.aborted) {
        return { status: "cancelled", rawOutput: "" };
      }
    }
    if (state.cancelled || signal?.aborted) {
      return { status: "cancelled", rawOutput: "" };
    }
    state.settled = true;
    return state.outcome;
  }

  async inspect(childThreadOrRunId: string): Promise<"active" | "gone"> {
    const override = this.inspectOverrides.get(childThreadOrRunId);
    if (override) return override;
    const state = this.states.get(childThreadOrRunId);
    if (!state) return "gone";
    return state.settled || state.cancelled ? "gone" : "active";
  }
}

export class FixtureParentThread implements ParentThreadPort {
  messages: ConversationTurn[] = [
    { role: "user", content: "How is the campaign pacing?", messageId: "m-1", createdAt: "2026-07-22T00:00:00.000Z" },
    {
      role: "assistant",
      content: "Spend is tracking ahead of plan.",
      messageId: "m-2",
      createdAt: "2026-07-22T00:01:00.000Z",
    },
  ];
  attachments: PermittedAttachment[] = [];

  async loadMessages(threadId: string, limit: number): Promise<ConversationTurn[]> {
    void threadId;
    return this.messages.slice(-limit);
  }

  async loadAttachments(threadId: string): Promise<PermittedAttachment[]> {
    void threadId;
    return this.attachments;
  }
}

export class DeterministicSummaryGenerator implements SummaryGenerator {
  generateCount = 0;

  async generate(input: { threadId: string; messages: ConversationTurn[] }): Promise<string> {
    this.generateCount += 1;
    const userMessages = input.messages.filter((message) => message.role === "user").length;
    return `Durable summary of thread ${input.threadId} covering ${userMessages} user message(s).`;
  }
}

export class StaticProviderCatalog implements ProviderCatalogPort {
  constructor(private readonly providers: AvailableProvider[]) {}

  async list(): Promise<AvailableProvider[]> {
    return this.providers;
  }
}

/** Fast in-memory repository for lifecycle tests that don't need real SQLite. */
export class InMemoryConsultationRepository implements ConsultationRepository {
  private readonly consultations = new Map<string, ConsultationRecord>();
  private readonly packets = new Map<string, ContextPacketRecord>();
  private readonly summaries: ThreadSummaryRecord[] = [];
  private readonly results = new Map<string, ConsultationResultRecord>();
  private readonly panelMembers: PanelMembershipRecord[] = [];

  saveConsultation(record: ConsultationRecord): void {
    this.consultations.set(record.id, record);
  }
  getConsultation(id: string): ConsultationRecord | null {
    return this.consultations.get(id) ?? null;
  }
  listByParentThread(parentThreadId: string): ConsultationRecord[] {
    return [...this.consultations.values()].filter((c) => c.parentThreadId === parentThreadId);
  }
  listByCampaignGroup(campaignGroupId: string): ConsultationRecord[] {
    return [...this.consultations.values()].filter((c) => c.campaignGroupId === campaignGroupId);
  }
  listByStatuses(statuses: readonly ConsultationStatus[]): ConsultationRecord[] {
    const set = new Set(statuses);
    return [...this.consultations.values()].filter((c) => set.has(c.status));
  }
  getByChildRun(childThreadOrRunId: string): ConsultationRecord | null {
    return [...this.consultations.values()].find((c) => c.childThreadOrRunId === childThreadOrRunId) ?? null;
  }
  listRetriesOf(consultationId: string): ConsultationRecord[] {
    return [...this.consultations.values()].filter((c) => c.retryOfConsultationId === consultationId);
  }
  saveContextPacket(record: ContextPacketRecord): void {
    this.packets.set(record.id, record);
  }
  getContextPacket(id: string): ContextPacketRecord | null {
    return this.packets.get(id) ?? null;
  }
  getContextPacketForConsultation(consultationId: string): ContextPacketRecord | null {
    return [...this.packets.values()].find((p) => p.consultationId === consultationId) ?? null;
  }
  saveThreadSummary(record: ThreadSummaryRecord): void {
    this.summaries.push(record);
  }
  getLatestThreadSummary(threadId: string): ThreadSummaryRecord | null {
    const matches = this.summaries.filter((s) => s.threadId === threadId);
    return matches[matches.length - 1] ?? null;
  }
  saveResult(record: ConsultationResultRecord): void {
    this.results.set(record.id, record);
  }
  getResult(id: string): ConsultationResultRecord | null {
    return this.results.get(id) ?? null;
  }
  getResultForConsultation(consultationId: string): ConsultationResultRecord | null {
    return [...this.results.values()].find((r) => r.consultationId === consultationId) ?? null;
  }
  savePanelMembership(record: PanelMembershipRecord): void {
    this.panelMembers.push(record);
  }
  listPanelMembers(parentPanelConsultationId: string): PanelMembershipRecord[] {
    return this.panelMembers.filter((m) => m.parentPanelConsultationId === parentPanelConsultationId);
  }
}

export interface TestCoordinatorOptions {
  repository: ConsultationRepository;
  contextProvider?: CampaignContextProvider;
  childExecution?: FixtureChildExecution;
  catalog?: AvailableProvider[];
  parentThread?: FixtureParentThread;
  clock?: DeterministicClock;
  ids?: SequentialIdGenerator;
  attachResult?: CoordinatorDeps["attachResult"];
  panelPollIntervalMs?: number;
  panelMaxWaitMs?: number;
}

export interface TestCoordinator {
  coordinator: ConsultationCoordinator;
  repository: ConsultationRepository;
  childExecution: FixtureChildExecution;
  parentThread: FixtureParentThread;
  contextProvider: FixtureCampaignContextProvider;
  summaryGenerator: DeterministicSummaryGenerator;
  clock: DeterministicClock;
  ids: SequentialIdGenerator;
}

/** Wire a coordinator with deterministic fixtures around a given repository. */
export function createTestCoordinator(options: TestCoordinatorOptions): TestCoordinator {
  const clock = options.clock ?? new DeterministicClock();
  const ids = options.ids ?? new SequentialIdGenerator();
  const childExecution = options.childExecution ?? new FixtureChildExecution();
  const parentThread = options.parentThread ?? new FixtureParentThread();
  const contextProvider =
    (options.contextProvider as FixtureCampaignContextProvider | undefined) ??
    new FixtureCampaignContextProvider();
  const summaryGenerator = new DeterministicSummaryGenerator();
  const threadSummaryService = new ThreadSummaryService({
    repository: options.repository,
    generator: summaryGenerator,
    clock,
    idGenerator: ids,
  });
  const contextPacketBuilder = new ContextPacketBuilder({
    repository: options.repository,
    contextProvider,
    threadSummaryService,
    parentThreadPort: parentThread,
    clock,
    idGenerator: ids,
  });
  const providerCatalog = new StaticProviderCatalog(
    options.catalog ?? [{ provider: "fixture", models: ["fixture-model"], authenticated: true }],
  );
  const coordinator = new ConsultationCoordinator({
    repository: options.repository,
    contextPacketBuilder,
    childExecution,
    providerCatalog,
    clock,
    idGenerator: ids,
    ...(options.attachResult ? { attachResult: options.attachResult } : {}),
    panelPollIntervalMs: options.panelPollIntervalMs ?? 1,
    ...(options.panelMaxWaitMs ? { panelMaxWaitMs: options.panelMaxWaitMs } : {}),
  });
  return { coordinator, repository: options.repository, childExecution, parentThread, contextProvider, summaryGenerator, clock, ids };
}

/** Resolve once a consultation satisfies `predicate` (or reject on timeout). */
export function waitForConsultation(
  coordinator: ConsultationCoordinator,
  id: string,
  predicate: (record: ConsultationRecord) => boolean,
  timeoutMs = 3000,
): Promise<ConsultationRecord> {
  return new Promise((resolve, reject) => {
    const existing = coordinator.get(id);
    if (existing && predicate(existing)) {
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for consultation ${id}`));
    }, timeoutMs);
    const unsubscribe = coordinator.subscribe((record) => {
      if (record.id === id && predicate(record)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(record);
      }
    });
  });
}

/** Resolve once a consultation reaches any terminal status. */
export function waitForTerminal(
  coordinator: ConsultationCoordinator,
  id: string,
  timeoutMs = 3000,
): Promise<ConsultationRecord> {
  return waitForConsultation(coordinator, id, (record) => isTerminalStatus(record.status), timeoutMs);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
