import { z } from "zod";

/**
 * Campaign agent role ids. Every installed + authenticated agent maps to
 * zero or more roles; an agent without any campaign role assignment will not
 * appear in campaign-scoped mention selectors or consultation routing.
 *
 * The four canonical campaign roles:
 * - daily_operator:  day-to-day pacing, alerts, budget checks
 * - strategic_reviewer:  long-term strategy, channel mix, creative
 * - figures_auditor:  spend-vs-plan reconciliation, KPI verification
 * - development:  implementation, tooling, automation
 */
export const CAMPAIGN_AGENT_ROLE_IDS = [
  "daily_operator",
  "strategic_reviewer",
  "figures_auditor",
  "development",
] as const;
export type CampaignAgentRoleId = (typeof CAMPAIGN_AGENT_ROLE_IDS)[number];

/** Human-readable labels surfaced in mention selectors. */
export const CAMPAIGN_AGENT_ROLE_LABELS: Record<CampaignAgentRoleId, string> = {
  daily_operator: "Daily Operator",
  strategic_reviewer: "Strategic Reviewer",
  figures_auditor: "Figures Auditor",
  development: "Development",
};

/** Role descriptions shown as tooltips or help text. */
export const CAMPAIGN_AGENT_ROLE_DESCRIPTIONS: Record<CampaignAgentRoleId, string> = {
  daily_operator:
    "Monitors day-to-day pacing, open alerts, and budget consumption. Best for routine check-ins and quick status queries.",
  strategic_reviewer:
    "Evaluates long-term strategy, channel mix, creative performance, and cross-campaign patterns. Best for planning reviews.",
  figures_auditor:
    "Reconciles spend-vs-plan, verifies KPIs, and audits platform-reported numbers. Best for financial accuracy checks.",
  development:
    "Implements automation, tooling, and integrations. Best for writing scripts, building dashboards, and connecting systems.",
};

/** Default agent kind hints per role. Resolved dynamically at runtime. */
export const DEFAULT_AGENT_KIND_FOR_ROLE: Partial<Record<CampaignAgentRoleId, string>> = {
  // Intentionally empty — role-to-provider mapping is resolved dynamically
  // from the installed agent catalog, not hardcoded. These serve only as
  // configuration hints that can be overridden per workspace.
};

export const campaignAgentRoleSchema = z.object({
  id: z.enum(CAMPAIGN_AGENT_ROLE_IDS),
  label: z.string().min(1),
  description: z.string(),
  /** Preferred agent kind hint (resolved dynamically at runtime). */
  preferredAgentKind: z.string().min(1).optional(),
});
export type CampaignAgentRole = z.infer<typeof campaignAgentRoleSchema>;

/** All four canonical roles as an array for iteration. */
export const CAMPAIGN_AGENT_ROLES: CampaignAgentRole[] = CAMPAIGN_AGENT_ROLE_IDS.map((id) => ({
  id,
  label: CAMPAIGN_AGENT_ROLE_LABELS[id],
  description: CAMPAIGN_AGENT_ROLE_DESCRIPTIONS[id],
  ...(DEFAULT_AGENT_KIND_FOR_ROLE[id] ? { preferredAgentKind: DEFAULT_AGENT_KIND_FOR_ROLE[id] } : {}),
}));
