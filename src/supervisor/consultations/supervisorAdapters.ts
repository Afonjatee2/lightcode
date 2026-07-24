import { randomUUID } from "node:crypto";
import type {
  AvailableProvider,
  CampaignContextProvider,
  ConsultationRole,
  ConversationTurn,
  PermittedAttachment,
} from "@/shared/consultations";
import { CONSULTATION_ROLES, FixtureCampaignContextProvider } from "@/shared/consultations";
import type { CampaignAgentRegistry } from "@/supervisor/campaign/campaignAgentRegistry";
import type { OrchestratorThreadManager } from "@/supervisor/crossagentMcp/OrchestratorThreadManager";
import { ContextPacketBuilder } from "./contextPacketBuilder";
import { ConsultationCoordinator } from "./coordinator";
import { OrchestratorChildExecution } from "./orchestratorChildExecution";
import type { Clock, IdGenerator, ParentThreadPort, ProviderCatalogPort } from "./ports";
import type { ConsultationRepository } from "./repository";
import { ThreadSummaryService } from "./threadSummaryService";

/**
 * Production adapter bindings + a factory that wires the central coordinator
 * into the supervisor runtime, reusing the existing OrchestratorThreadManager
 * child-thread lane and the dynamic CampaignAgentRegistry for provider
 * resolution. The CampaignContextProvider defaults to the deterministic fixture
 * until the Phase 3 Control Centre adapter is supplied (the ONLY swap needed).
 */

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class UuidIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

/** Resolves eligible providers/models from the live, authenticated agent catalog. */
export class CampaignAgentProviderCatalog implements ProviderCatalogPort {
  constructor(private readonly registry: CampaignAgentRegistry) {}

  async list(): Promise<AvailableProvider[]> {
    const entries = await this.registry.resolveAll();
    const validRoles = new Set<string>(CONSULTATION_ROLES);
    return entries.map((entry) => ({
      provider: entry.agentKind,
      models: entry.spawnable.models.map((model) => model.value),
      authenticated: true,
      roles: entry.roles
        .map((role) => role as string)
        .filter((role): role is ConsultationRole => validRoles.has(role)),
    }));
  }
}

/** Supplies the parent thread's conversation + attachments to the packet builder. */
export interface ParentThreadLoader {
  loadMessages(threadId: string, limit: number): Promise<ConversationTurn[]>;
  loadAttachments?(threadId: string): Promise<PermittedAttachment[]>;
}

export class LoaderParentThreadPort implements ParentThreadPort {
  constructor(private readonly loader: ParentThreadLoader) {}

  loadMessages(threadId: string, limit: number): Promise<ConversationTurn[]> {
    return this.loader.loadMessages(threadId, limit);
  }

  loadAttachments(threadId: string): Promise<PermittedAttachment[]> {
    return this.loader.loadAttachments?.(threadId) ?? Promise.resolve([]);
  }
}

export interface SupervisorConsultationWiring {
  repository: ConsultationRepository;
  orchestrator: OrchestratorThreadManager;
  registry: CampaignAgentRegistry;
  parentThreadLoader: ParentThreadLoader;
  /** Defaults to the deterministic fixture; supply the Phase 3 CC adapter when ready. */
  contextProvider?: CampaignContextProvider;
  attachResult?: (attachment: import("@/shared/consultations").ConsultationResultAttachment) => void;
}

export function createSupervisorConsultationCoordinator(
  wiring: SupervisorConsultationWiring,
): ConsultationCoordinator {
  const clock = new SystemClock();
  const idGenerator = new UuidIdGenerator();
  const contextProvider = wiring.contextProvider ?? new FixtureCampaignContextProvider();
  const threadSummaryService = new ThreadSummaryService({
    repository: wiring.repository,
    generator: {
      async generate(input) {
        return extractiveSummary(input.threadId, input.messages);
      },
    },
    clock,
    idGenerator,
  });
  const contextPacketBuilder = new ContextPacketBuilder({
    repository: wiring.repository,
    contextProvider,
    threadSummaryService,
    parentThreadPort: new LoaderParentThreadPort(wiring.parentThreadLoader),
    clock,
    idGenerator,
  });
  const childExecution = new OrchestratorChildExecution({
    orchestrator: wiring.orchestrator,
    resolveParentThreadId: (childThreadOrRunId) =>
      wiring.repository.getByChildRun(childThreadOrRunId)?.parentThreadId,
  });
  return new ConsultationCoordinator({
    repository: wiring.repository,
    contextPacketBuilder,
    childExecution,
    providerCatalog: new CampaignAgentProviderCatalog(wiring.registry),
    clock,
    idGenerator,
    ...(wiring.attachResult ? { attachResult: wiring.attachResult } : {}),
  });
}

/**
 * Deterministic extractive thread summary. Takes the most recent meaningful
 * messages (up to ~2000 chars), concatenates their first lines, and returns a
 * safe one-paragraph summary. Never includes hidden reasoning — the calling
 * builder already filters those from the message list.
 */
function extractiveSummary(threadId: string, messages: ConversationTurn[]): string {
  const meaningful = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      message.content.trim().length > 0,
  );
  if (meaningful.length === 0) {
    return `Campaign consultation thread ${threadId.slice(0, 8)}`;
  }
  let total = 0;
  const lines: string[] = [];
  // Walk most recent first, build the summary in reverse order.
  for (let i = meaningful.length - 1; i >= 0 && total < 2_000 && lines.length < 12; i--) {
    const firstLine = meaningful[i]!.content.split("\n")[0]!.trim();
    if (firstLine.length === 0) continue;
    lines.push(
      meaningful[i]!.role === "user"
        ? `User asked: "${firstLine.slice(0, 180)}"`
        : `Assistant said: "${firstLine.slice(0, 180)}"`,
    );
    total += firstLine.length;
  }
  const joined = lines.reverse().join("; ");
  return joined.length > 0 ? joined : `Thread ${threadId.slice(0, 8)} conversation.`;
}
