import {
  CAMPAIGN_AGENT_ROLES,
} from "@/shared/contracts/campaign/agentRole";

/**
 * Build the Crossagents MCP routing guide for campaign agents.
 * This guide is injected into the MCP `initialize` instructions so
 * every agent connected through Crossagents knows about the campaign
 * agent roles and how to use them.
 *
 * The routing guide is read live from shared settings at turn time
 * (via `getRoutingGuide`), so edits take effect without a restart.
 * When no guide is configured, the campaign roles are still available
 * through the dynamic agent registry.
 */
export function buildCampaignRoutingGuide(): string {
  const roleLines = CAMPAIGN_AGENT_ROLES.map((role) => {
    return `- @${role.id} (${role.label}): ${role.description}`;
  });

  return [
    "CAMPAIGN AGENT ROLES",
    "When the user mentions a campaign agent role, delegate the task to the appropriate agent:",
    "",
    ...roleLines,
    "",
    "ROUTING RULES",
    "- Use @daily_operator for: pacing checks, alert monitoring, budget consumption queries, routine status reports.",
    "- Use @strategic_reviewer for: strategy evaluation, channel mix analysis, creative performance review, long-term planning.",
    "- Use @figures_auditor for: spend-vs-plan reconciliation, KPI verification, platform data auditing, financial accuracy.",
    "- Use @development for: automation scripts, dashboard building, tool integration, system configuration.",
    "",
    "HOW TO DELEGATE",
    "1. Call get_campaign_context from the Control Centre MCP to fetch the campaign data.",
    "2. Format the user's question with the campaign context as a self-contained prompt.",
    "3. Use create_thread or spawn_agent (whichever fits the task size) to delegate to the right agent.",
    "4. Collect the result and present it to the user with clear findings and recommendations.",
    "",
    "IMPORTANT",
    "- Each delegated task should be self-contained — the child agent does NOT share your conversation.",
    "- Prefer fast/cheap models for routine checks; reserve strong models for strategic analysis.",
    "- The user can watch child threads in the app sidebar — they see progress in real time.",
    "- ALWAYS include the relevant campaign data (budget, pacing, alerts) in the delegated prompt.",
    "- Campaign context comes from the Control Centre MCP tools — use them before delegating.",
  ].join("\n");
}
