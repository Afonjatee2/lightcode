import { z } from "zod";

/**
 * Agent role presets for campaign workspace consultations.
 * Each role defines a default agent/model, permission level, and whether
 * the agent can apply platform changes (only through CC approval).
 */
export const agentRoleSchema = z.enum([
  "daily_operator",
  "strategic_reviewer",
  "figures_auditor",
  "development",
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export interface AgentRolePreset {
  role: AgentRole;
  label: string;
  description: string;
  defaultAgentKind: string;
  defaultModel: string;
  permissions: "read_only" | "read_propose" | "read_verify" | "full";
  canApplyChanges: boolean;
}

export const AGENT_ROLE_PRESETS: AgentRolePreset[] = [
  {
    role: "daily_operator",
    label: "Daily Operator",
    description:
      "Day-to-day campaign monitoring, alert triage, client updates. Uses DeepSeek/Qwen/Kimi.",
    defaultAgentKind: "deepseek",
    defaultModel: "deepseek-v4-pro",
    permissions: "read_propose",
    canApplyChanges: false,
  },
  {
    role: "strategic_reviewer",
    label: "Strategic Reviewer",
    description:
      "High-level strategy review. Read + propose, never apply. Uses Claude.",
    defaultAgentKind: "claude",
    defaultModel: "claude-sonnet-4-20250514",
    permissions: "read_propose",
    canApplyChanges: false,
  },
  {
    role: "figures_auditor",
    label: "Figures Auditor",
    description:
      "Verify calculations, audit spend figures, recalculate KPIs. Read + verify only. Uses Codex.",
    defaultAgentKind: "codex",
    defaultModel: "gpt-5.2-codex",
    permissions: "read_verify",
    canApplyChanges: false,
  },
  {
    role: "development",
    label: "Development Agent",
    description: "Code changes, script writing, technical tasks. Full access.",
    defaultAgentKind: "claude",
    defaultModel: "claude-sonnet-4-20250514",
    permissions: "full",
    canApplyChanges: true,
  },
];

export function getRolePreset(role: AgentRole): AgentRolePreset | undefined {
  return AGENT_ROLE_PRESETS.find((p) => p.role === role);
}
