import type {
  ConsultationAlert,
  ConsultationChannel,
  ConsultationDecision,
  ConsultationEvent,
  ConsultationEvidence,
  ConsultationKpi,
  ConsultationProposal,
  ConsultationSourceHealth,
} from "./types";

/**
 * The narrow provider interface Phase 4 depends on. The concrete adapter that
 * talks to the Control Centre (Phase 3) lives elsewhere and maps whatever wire
 * fields the CC returns into this shape — so Phase 4 never depends on exact
 * Control Centre wire field names. Swapping the fixture for the real adapter is
 * the ONLY change needed when Phase 3 lands.
 */
export interface CampaignContextProvider {
  getCampaignContext(
    projectId: string,
    campaignGroupId: string,
    signal?: AbortSignal,
  ): Promise<CampaignContextForConsultation>;
}

export interface CampaignContextForConsultation {
  campaignGroupId: string;
  campaignName: string;
  clientName: string | null;
  status: string;
  dates: { startDate: string; endDate: string };
  budget: {
    totalBudget: number | null;
    spentToDate: number;
    remaining: number | null;
    percentUsed: number | null;
    expectedPercentUsed: number | null;
    pacingStatus: string | null;
  };
  kpis: ConsultationKpi[];
  channels: ConsultationChannel[];
  sourceHealth: ConsultationSourceHealth[];
  openAlerts: ConsultationAlert[];
  activeDecisions: ConsultationDecision[];
  pendingProposals: ConsultationProposal[];
  recentEvents: ConsultationEvent[];
  evidence: ConsultationEvidence[];
  suggestedQuestions: string[];
}
