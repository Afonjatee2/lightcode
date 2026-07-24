import { z } from "zod";

/**
 * Which Control Centre MCP tool subset/permission profile a campaign
 * project's MCP connection is configured for. Threaded through to the
 * Control Centre MCP server's launch env (see `applyCampaignMcpProfile`)
 * so the same server binary can expose a narrower or wider tool surface
 * depending on what the active workspace needs.
 *
 * - `monitoring`: read-only campaign health, alerts, KPIs (the default).
 * - `plan_revision`: adds plan/KPI-target editing tools.
 * - `client_comms`: adds client-facing note/report tools.
 * - `deployment`: adds platform action-proposal/apply tools.
 * - `development`: full tool surface, used for building the workspace itself.
 */
export const MCP_PROFILES = [
  "monitoring",
  "plan_revision",
  "client_comms",
  "deployment",
  "development",
] as const;
export const mcpProfileSchema = z.enum(MCP_PROFILES);
export type McpProfile = z.infer<typeof mcpProfileSchema>;

export const DEFAULT_MCP_PROFILE: McpProfile = "monitoring";
