/**
 * Campaign agent registry, routing guide and the durable consultation store.
 *
 * The earlier Phase 4 consultation implementation that lived here
 * (`consultationService`, `mentionRouter`, `contextPacketBuilder`,
 * `threadSummaryService`, `campaignCrossagentBridge`) was superseded by the
 * central coordinator in `src/supervisor/consultations/` and the shared domain
 * in `src/shared/consultations/`. Those competing files were removed (Part 10)
 * so there is exactly ONE consultation implementation. Only the still-used
 * building blocks remain exported below.
 */
export { CampaignAgentRegistry } from "./campaignAgentRegistry";
export type { CampaignAgentEntry, CampaignAgentRegistryDeps } from "./campaignAgentRegistry";

export { ConsultationStore } from "./consultationStore";
export type { ConsultationStoreDeps } from "./consultationStore";

export { buildCampaignRoutingGuide } from "./routingGuide";
