/**
 * Barrel export for all campaign-domain Zod contracts.
 *
 * Layer 1 — exact wire schemas (mirror Control Centre's contract):
 *   controlCentreCampaignContext, controlCentreOperationsToday
 *
 * Layer 2 — view-model adapters (UI-friendly mappings):
 *   (defined in src/renderer/adapters/)
 *
 * Re-exports only production schemas and their inferred TypeScript types.
 * Test files under this folder are never re-exported.
 */

export * from "./campaignWorkspaceProject";
export * from "./workspaceThread";
export * from "./workspaceMessage";
export * from "./agentConsultation";
export * from "./threadSummary";
export * from "./campaignDecision";
export * from "./evidencePacket";
export * from "./campaignActionProposal";
export * from "./agentRoles";
export * from "./consultationContextPacket";
export * from "./mcpProfile";
export * from "./campaignMcpLaunch";
export * from "./controlCentreCampaignContext";
export * from "./controlCentreOperationsToday";

// Legacy re-exports — keep backward compatibility for existing consumers
// that import from campaignContext / operationsToday directly.
export * from "./campaignContext";
export * from "./operationsToday";
