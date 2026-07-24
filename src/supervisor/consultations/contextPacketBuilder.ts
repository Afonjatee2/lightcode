import {
  CONTEXT_PACKET_CONTRACT_VERSION,
  can,
  type CampaignContextForConsultation,
  type CampaignContextProvider,
  type ConsultationContextPacketBody,
  type ConsultationRole,
  type ContextPacketRecord,
  type ConversationTurn,
  type EvidenceFreshnessSummary,
  type PermittedAttachment,
} from "@/shared/consultations";
import { contentHash } from "./hash";
import type { Clock, IdGenerator, ParentThreadPort } from "./ports";
import { redactPacketBody } from "./redact";
import type { ConsultationRepository } from "./repository";
import type { ThreadSummaryService } from "./threadSummaryService";

/**
 * Context-packet builder (Part 6). It retrieves its OWN approved inputs — the
 * caller never hands it a finished context object. Flow: load the parent thread,
 * ensure a durable summary, select recent messages within budget, fetch campaign
 * context through the provider, select role-permitted facts, fold in evidence
 * freshness + missing-data warnings + permitted attachments, redact secrets,
 * then persist the exact packet with a content hash.
 */
export interface ContextPacketBuilderDeps {
  repository: ConsultationRepository;
  contextProvider: CampaignContextProvider;
  threadSummaryService: ThreadSummaryService;
  parentThreadPort: ParentThreadPort;
  clock: Clock;
  idGenerator: IdGenerator;
  summaryProvider?: string;
  summaryModel?: string;
  maxRecentMessages?: number;
  maxRecentChars?: number;
  maxAttachmentExcerptChars?: number;
}

const DEFAULT_MAX_RECENT_MESSAGES = 20;
const DEFAULT_MAX_RECENT_CHARS = 16_000;
const DEFAULT_MAX_ATTACHMENT_EXCERPT_CHARS = 2_000;

export interface BuildContextPacketInput {
  consultationId: string;
  parentProjectId: string;
  parentThreadId: string;
  campaignGroupId: string;
  role: ConsultationRole;
  originalMention: string;
  explicitTask: string;
  signal?: AbortSignal;
}

export interface BuiltContextPacket {
  record: ContextPacketRecord;
  body: ConsultationContextPacketBody;
}

export class ContextPacketBuilder {
  private readonly maxRecentMessages: number;
  private readonly maxRecentChars: number;
  private readonly maxAttachmentExcerptChars: number;
  private readonly summaryProvider: string;
  private readonly summaryModel: string;

  constructor(private readonly deps: ContextPacketBuilderDeps) {
    this.maxRecentMessages = deps.maxRecentMessages ?? DEFAULT_MAX_RECENT_MESSAGES;
    this.maxRecentChars = deps.maxRecentChars ?? DEFAULT_MAX_RECENT_CHARS;
    this.maxAttachmentExcerptChars =
      deps.maxAttachmentExcerptChars ?? DEFAULT_MAX_ATTACHMENT_EXCERPT_CHARS;
    this.summaryProvider = deps.summaryProvider ?? "poracode-summary";
    this.summaryModel = deps.summaryModel ?? "deterministic";
  }

  async build(input: BuildContextPacketInput): Promise<BuiltContextPacket> {
    const now = this.deps.clock.now();

    const allMessages = await this.deps.parentThreadPort.loadMessages(
      input.parentThreadId,
      this.maxRecentMessages * 2,
    );
    const summaryRecord = await this.deps.threadSummaryService.ensureSummary({
      threadId: input.parentThreadId,
      messages: allMessages,
      provider: this.summaryProvider,
      model: this.summaryModel,
    });
    const recent = selectRecentMessages(allMessages, this.maxRecentMessages, this.maxRecentChars);

    const context = await this.deps.contextProvider.getCampaignContext(
      input.parentProjectId,
      input.campaignGroupId,
      input.signal,
    );

    const attachments = can(input.role, "read_selected_attachments")
      ? await this.loadAttachments(input.parentThreadId)
      : [];

    const missingDataWarnings = computeMissingDataWarnings(context);
    const evidenceFreshness = computeEvidenceFreshness(context);

    const draft: ConsultationContextPacketBody = {
      parentRequest: input.originalMention,
      explicitTask: input.explicitTask,
      relevantRecentConversation: recent,
      durableThreadSummary: summaryRecord.summary,
      campaignIdentity: {
        campaignGroupId: context.campaignGroupId,
        campaignName: context.campaignName,
        clientName: context.clientName,
        status: context.status,
      },
      dates: context.dates,
      budget: can(input.role, "read_campaign_context") ? context.budget : emptyBudget(),
      kpiEvidence: can(input.role, "read_campaign_context") ? context.kpis : [],
      alerts: can(input.role, "read_campaign_context") ? context.openAlerts : [],
      activeDecisions: can(input.role, "read_campaign_context") ? context.activeDecisions : [],
      pendingProposals: can(input.role, "read_campaign_context") ? context.pendingProposals : [],
      recentCampaignEvents: can(input.role, "read_campaign_events") ? context.recentEvents : [],
      permittedAttachments: attachments,
      evidenceFreshness,
      missingDataWarnings,
      permissionConstraints: [],
      redactionMetadata: { redactedCount: 0, redactedFields: [], appliedAt: now },
      createdAt: now,
      contractVersion: CONTEXT_PACKET_CONTRACT_VERSION,
      contentHash: "",
    };

    const { body: redactedBody, metadata } = redactPacketBody(draft);
    const permissionConstraints = permissionConstraintLines(input.role);
    const withConstraints: ConsultationContextPacketBody = {
      ...redactedBody,
      permissionConstraints,
      redactionMetadata: metadata,
    };
    const hash = contentHash(withConstraints);
    const finalBody: ConsultationContextPacketBody = { ...withConstraints, contentHash: hash };

    const record: ContextPacketRecord = {
      id: this.deps.idGenerator.next(),
      consultationId: input.consultationId,
      structuredContext: finalBody,
      contentHash: hash,
      contractVersion: CONTEXT_PACKET_CONTRACT_VERSION,
      redactionMetadata: metadata,
      evidenceFreshness,
      missingDataWarnings,
      createdAt: now,
    };
    this.deps.repository.saveContextPacket(record);
    return { record, body: finalBody };
  }

  private async loadAttachments(parentThreadId: string): Promise<PermittedAttachment[]> {
    if (!this.deps.parentThreadPort.loadAttachments) return [];
    const attachments = await this.deps.parentThreadPort.loadAttachments(parentThreadId);
    return attachments.map((attachment) => ({
      ...attachment,
      excerpt: attachment.excerpt.slice(0, this.maxAttachmentExcerptChars),
    }));
  }
}

function permissionConstraintLines(role: ConsultationRole): string[] {
  const lines: string[] = [
    `Role: ${role}. Read-only-first permission policy (${can(role, "modify_repository") ? "may write handoff files" : "no repository writes"}).`,
  ];
  if (!can(role, "search_web")) lines.push("No web search.");
  if (!can(role, "use_browser")) lines.push("No browser access.");
  if (!can(role, "run_shell")) lines.push("No shell access.");
  lines.push("No credential access and no live platform actions. Suggest proposal inputs only; never apply them.");
  return lines;
}

function selectRecentMessages(
  messages: ConversationTurn[],
  maxMessages: number,
  maxChars: number,
): ConversationTurn[] {
  const selected: ConversationTurn[] = [];
  let chars = 0;
  const candidates = messages.slice(-maxMessages * 2).reverse();
  for (const message of candidates) {
    if (selected.length >= maxMessages) break;
    if (message.content.trim().length === 0) continue;
    if (chars + message.content.length > maxChars && selected.length > 0) break;
    selected.push(message);
    chars += message.content.length;
  }
  return selected.reverse();
}

function emptyBudget(): ConsultationContextPacketBody["budget"] {
  return {
    totalBudget: null,
    spentToDate: 0,
    remaining: null,
    percentUsed: null,
    expectedPercentUsed: null,
    pacingStatus: null,
  };
}

function computeMissingDataWarnings(context: CampaignContextForConsultation): string[] {
  const warnings: string[] = [];
  if (context.budget.totalBudget === null) warnings.push("Total budget is not set for this campaign.");
  if (context.budget.remaining === null) warnings.push("Remaining budget is unknown.");
  if (context.budget.percentUsed === null) warnings.push("Percent of budget used is unavailable.");
  for (const source of context.sourceHealth) {
    if (source.status !== "healthy") {
      warnings.push(
        `Source "${source.sourceName}" is ${source.status}${source.reason ? ` (${source.reason})` : ""}; its numbers may be out of date.`,
      );
    }
  }
  for (const kpi of context.kpis) {
    if (kpi.actualValue === null) {
      warnings.push(`KPI "${kpi.metricKey}" has no actual value recorded yet.`);
    }
  }
  if (context.clientName === null) warnings.push("Client name is not set.");
  return warnings;
}

function computeEvidenceFreshness(context: CampaignContextForConsultation): EvidenceFreshnessSummary {
  const captured: string[] = [];
  const statuses: Array<{ label: string; freshnessStatus: string }> = [];
  for (const claim of context.evidence) {
    for (const source of claim.sources) {
      if (source.capturedAt) captured.push(source.capturedAt);
      statuses.push({ label: source.label, freshnessStatus: source.freshnessStatus });
    }
  }
  let staleSourceCount = 0;
  for (const source of context.sourceHealth) {
    if (source.status !== "healthy") staleSourceCount += 1;
    if (source.lastSuccessfulSyncAt) captured.push(source.lastSuccessfulSyncAt);
  }
  const sorted = captured.slice().sort();
  return {
    oldestCapturedAt: sorted[0] ?? null,
    newestCapturedAt: sorted[sorted.length - 1] ?? null,
    staleSourceCount,
    statuses,
  };
}
