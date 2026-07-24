import type {
  CampaignContextForConsultation,
  CampaignContextProvider,
  ConsultationAlert,
  ConsultationChannel,
  ConsultationDecision,
  ConsultationEvent,
  ConsultationEvidence,
  ConsultationKpi,
  ConsultationProposal,
  ConsultationSourceHealth,
} from "@/shared/consultations";
import {
  controlCentreCampaignContextSchema,
  type ControlCentreCampaignContext,
} from "@/shared/contracts/campaign/controlCentreCampaignContext";
import type { ControlCentreGateway } from "./controlCentreGateway";

const GET_CAMPAIGN_CONTEXT_TOOL = "get_campaign_context";

export class ControlCentreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlCentreUnavailableError";
  }
}

/**
 * Production consultation provider. The MCP response is first validated against
 * the exact Phase 3 wire contract, then mapped into the smaller consultation
 * model. Required arrays and nested evidence sources can never silently turn
 * into empty values.
 */
export class PoracodeCampaignContextProvider implements CampaignContextProvider {
  constructor(private readonly gateway: ControlCentreGateway) {}

  async getCampaignContext(
    projectId: string,
    campaignGroupId: string,
    signal?: AbortSignal,
  ): Promise<CampaignContextForConsultation> {
    const outcome = await this.gateway.callTool(
      projectId,
      GET_CAMPAIGN_CONTEXT_TOOL,
      { id: campaignGroupId },
      signal,
    );
    if (outcome.status !== "ok") {
      throw new ControlCentreUnavailableError(outcome.message);
    }

    const parsed = controlCentreCampaignContextSchema.safeParse(outcome.content);
    if (!parsed.success) {
      const issueSummary = parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
        .join("; ");
      throw new ControlCentreUnavailableError(
        `Control Centre returned an invalid campaign context${issueSummary ? ` (${issueSummary})` : ""}.`,
      );
    }
    if (parsed.data.identity.id !== campaignGroupId) {
      throw new ControlCentreUnavailableError(
        "Control Centre returned campaign context for a different campaign group.",
      );
    }
    return mapCampaignContext(parsed.data);
  }
}

function mapCampaignContext(raw: ControlCentreCampaignContext): CampaignContextForConsultation {
  return {
    campaignGroupId: raw.identity.id,
    campaignName: raw.identity.name,
    clientName: raw.identity.clientName,
    status: raw.identity.status,
    dates: {
      startDate: raw.identity.startDate,
      endDate: raw.identity.endDate,
    },
    budget: {
      totalBudget: raw.budget.totalBudget,
      spentToDate: raw.budget.spentToDate,
      remaining: raw.budget.remaining,
      percentUsed: raw.budget.percentUsed,
      expectedPercentUsed: raw.budget.expectedPercentUsed,
      pacingStatus: raw.budget.pacingStatus,
    },
    kpis: raw.kpiTargets.map(mapKpi),
    channels: raw.channelExecutions.map(mapChannel),
    sourceHealth: raw.sourceHealth.map(mapSourceHealth),
    openAlerts: raw.openAlerts.map(mapAlert),
    activeDecisions: raw.activeDecisions.map(mapDecision),
    pendingProposals: raw.pendingProposals.map(mapProposal),
    recentEvents: raw.recentEvents.map(mapEvent),
    evidence: raw.evidence.map(mapEvidence),
    suggestedQuestions: [...raw.suggestedQuestions],
  };
}

function mapKpi(raw: ControlCentreCampaignContext["kpiTargets"][number]): ConsultationKpi {
  return {
    id: raw.id,
    metricKey: raw.metricKey,
    targetType: raw.targetType,
    targetValue: raw.targetValue,
    actualValue: raw.actualValue,
    percentAchieved: raw.percentAchieved,
    status: raw.status,
  };
}

function mapChannel(raw: ControlCentreCampaignContext["channelExecutions"][number]): ConsultationChannel {
  return {
    id: raw.id,
    channelLabel: raw.channelLabel,
    platform: raw.platform,
    plannedBudget: raw.plannedBudget,
    actualSpend: raw.actualSpend,
    status: raw.status,
  };
}

function mapSourceHealth(raw: ControlCentreCampaignContext["sourceHealth"][number]): ConsultationSourceHealth {
  return {
    sourceAccountId: raw.sourceAccountId,
    sourceName: raw.sourceName,
    status: raw.status,
    lastSuccessfulSyncAt: raw.lastSuccessfulSyncAt,
    reason: raw.reason,
  };
}

function mapAlert(raw: ControlCentreCampaignContext["openAlerts"][number]): ConsultationAlert {
  return {
    id: raw.id,
    title: raw.title,
    severity: raw.severity,
    priority: raw.priority,
    openedAt: raw.openedAt,
  };
}

function mapDecision(raw: ControlCentreCampaignContext["activeDecisions"][number]): ConsultationDecision {
  return {
    id: raw.id,
    statement: raw.title,
    reason: null,
    scopeType: raw.decisionType,
    startsAt: raw.createdAt,
    expiresAt: null,
    sourceType: "control_centre",
    createdBy: raw.status,
  };
}

function mapProposal(raw: ControlCentreCampaignContext["pendingProposals"][number]): ConsultationProposal {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    summary: raw.riskLevel ? `Risk level: ${raw.riskLevel}` : null,
    createdAt: raw.createdAt,
  };
}

function mapEvent(raw: ControlCentreCampaignContext["recentEvents"][number]): ConsultationEvent {
  return {
    id: raw.id,
    eventType: raw.eventType,
    description: raw.description ?? raw.title,
    occurredAt: raw.createdAt,
    severity: raw.severity,
  };
}

function mapEvidence(raw: ControlCentreCampaignContext["evidence"][number]): ConsultationEvidence {
  return {
    claimKey: raw.claimKey,
    statement: raw.statement,
    result: raw.calculation?.result ?? null,
    sources: raw.sources.map((source) => ({
      sourceType: source.sourceType,
      label: source.label,
      capturedAt: source.capturedAt,
      freshnessStatus: source.freshnessStatus,
    })),
  };
}
