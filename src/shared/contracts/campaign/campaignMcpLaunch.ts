import type { McpServer } from "../mcpServer";
import { DEFAULT_MCP_PROFILE, type McpProfile } from "./mcpProfile";

/**
 * Provider-visible name of the user-configured Control Centre MCP server.
 * A project opts into campaign tooling by adding a custom MCP server with
 * this name (see `McpSection`); `applyCampaignMcpProfile` then threads the
 * project's selected profile into that one server's launch config.
 */
export const CONTROL_CENTRE_MCP_SERVER_NAME = "control-centre";

/** Env var the Control Centre MCP server reads to select its tool profile. */
export const CONTROL_CENTRE_MCP_PROFILE_ENV_VAR = "CONTROL_CENTRE_MCP_PROFILE";

/** HTTP/SSE header equivalent, for non-stdio Control Centre connections. */
export const CONTROL_CENTRE_MCP_PROFILE_HEADER = "x-control-centre-mcp-profile";

function isControlCentreServer(server: McpServer): boolean {
  return server.name.trim().toLowerCase() === CONTROL_CENTRE_MCP_SERVER_NAME;
}

/**
 * Threads a campaign project's selected `McpProfile` into its Control Centre
 * MCP server launch config, defaulting to `"monitoring"` when unset. Applied
 * to whichever server (by name) is the project's Control Centre connection,
 * leaving every other custom MCP server untouched.
 *
 * Safe to call unconditionally for any project's merged/enabled MCP server
 * list — it is a no-op when no server named `control-centre` is present.
 */
export function applyCampaignMcpProfile(
  servers: readonly McpServer[],
  profile: McpProfile = DEFAULT_MCP_PROFILE,
): McpServer[] {
  return servers.map((server) => {
    if (!isControlCentreServer(server)) return server;
    if (server.transport.type === "stdio") {
      return {
        ...server,
        transport: {
          ...server.transport,
          env: { ...server.transport.env, [CONTROL_CENTRE_MCP_PROFILE_ENV_VAR]: profile },
        },
      };
    }
    // Remote HTTP/SSE servers are server-managed.
    // Do not inject any client-controlled profile headers to avoid privilege elevation.
    return server;
  });
}
