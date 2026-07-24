import type { AgentKind, AgentCapability } from "@/shared/contracts";
import type {
  CampaignAgentRoleId,
} from "@/shared/contracts/campaign/agentRole";
import { CAMPAIGN_AGENT_ROLE_IDS } from "@/shared/contracts/campaign/agentRole";
import type { SpawnableAgent } from "@/supervisor/crossagentMcp/types";

/**
 * A resolved campaign agent: a spawnable agent paired with one or more
 * campaign roles it can fill. Built dynamically from the installed catalog
 * so no provider is ever hardcoded.
 */
export interface CampaignAgentEntry {
  /** Provider kind this entry maps to. */
  agentKind: AgentKind;
  /** The agent's full spawnable catalog (models, reasoning, etc.). */
  spawnable: SpawnableAgent;
  /** Roles this agent is assigned to. An agent can fill multiple roles. */
  roles: CampaignAgentRoleId[];
  /** Capability snapshot used for role resolution. */
  capabilities: AgentCapability;
}

export interface CampaignAgentRegistryDeps {
  /** Get the current spawnable agent catalog (installed + authenticated). */
  getSpawnableAgents: () => Promise<SpawnableAgent[]>;
  /** Get persisted capabilities for an agent kind. */
  getCapabilities: (kind: AgentKind) => AgentCapability | undefined;
}

/**
 * Dynamic provider/model registry for campaign agent roles. Never hardcodes
 * a provider — all mappings are resolved from the installed agent catalog at
 * call time. A provider that is uninstalled or unauthenticated is simply not
 * offered for any role; the mention selector falls back to the first available
 * agent.
 *
 * Role assignment is governed by simple heuristics:
 * - strongest model → strategic_reviewer
 * - fastest model → daily_operator
 * - most balanced → figures_auditor + development
 * An agent with only one model fills every role it's eligible for.
 */
export class CampaignAgentRegistry {
  constructor(private readonly deps: CampaignAgentRegistryDeps) {}

  /** All spawnable agents with their assigned campaign roles. */
  async resolveAll(): Promise<CampaignAgentEntry[]> {
    const agents = await this.deps.getSpawnableAgents();
    const entries: CampaignAgentEntry[] = [];
    for (const agent of agents) {
      const caps = this.deps.getCapabilities(agent.provider.value as AgentKind);
      if (!caps) continue;
      const roles = this.assignRoles(agent);
      if (roles.length === 0) continue;
      entries.push({
        agentKind: agent.provider.value as AgentKind,
        spawnable: agent,
        roles,
        capabilities: caps,
      });
    }
    return entries;
  }

  /**
   * Resolve the best agent for a given role. Returns the first agent assigned
   * to that role, preferring agents that have the role as their primary match.
   */
  async resolveForRole(role: CampaignAgentRoleId): Promise<CampaignAgentEntry | undefined> {
    const entries = await this.resolveAll();
    // Prefer agents where this role is their first assignment (primary match).
    const primary = entries.find((e) => e.roles[0] === role);
    if (primary) return primary;
    // Fall back to any agent assigned to this role.
    return entries.find((e) => e.roles.includes(role));
  }

  /** Get all agents that can fill a given role. */
  async listForRole(role: CampaignAgentRoleId): Promise<CampaignAgentEntry[]> {
    const entries = await this.resolveAll();
    return entries.filter((e) => e.roles.includes(role));
  }

  /**
   * Assign campaign roles to a spawnable agent based on its model catalog.
   *
   * Heuristic (provider-agnostic, keyword-based):
   * - An agent whose strongest model is "max-capability" gets strategic_reviewer.
   * - An agent whose fastest model is "fast-cheap" gets daily_operator.
   * - Every agent with a "balanced" model gets figures_auditor + development.
   * - Single-model agents get all four roles (best-effort).
   */
  private assignRoles(agent: SpawnableAgent): CampaignAgentRoleId[] {
    const tiers = new Set(agent.models.map((m) => m.tier));
    const roles: CampaignAgentRoleId[] = [];

    if (agent.models.length === 1) {
      // Single-model agent: assign all roles it's capable of.
      return [...CAMPAIGN_AGENT_ROLE_IDS];
    }

    if (tiers.has("max-capability")) roles.push("strategic_reviewer");
    if (tiers.has("fast-cheap")) roles.push("daily_operator");
    if (tiers.has("balanced")) {
      roles.push("figures_auditor");
      roles.push("development");
    }
    // Ensure at least one role if nothing matched (edge case).
    if (roles.length === 0) {
      if (tiers.has("max-capability")) roles.push("figures_auditor");
      else if (tiers.has("fast-cheap")) roles.push("daily_operator");
    }
    return roles;
  }
}
