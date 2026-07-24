import type { DeploymentHttpTransport } from "./controlCentreClient";

/**
 * Maps the HTTP-shaped ControlCentreClient transport to Control Centre MCP
 * tool calls. Poracode's renderer reaches these tools through
 * `readBridge().callMcpTool` (see `useDeploymentClient`).
 */
export function createMcpDeploymentTransport(
  callTool: (toolName: string, args: unknown) => Promise<unknown>,
): DeploymentHttpTransport {
  return {
    async get(path: string) {
      const listMatch = path.match(
        /^\/campaign-groups\/([^/]+)\/action-proposals(?:\?status=([^&]+))?$/,
      );
      if (listMatch) {
        const [, campaignGroupId, status] = listMatch;
        const args: Record<string, unknown> = { campaignGroupId };
        if (status) args.status = status;
        return callTool("list_pending_action_proposals", args);
      }

      const getMatch = path.match(/^\/action-proposals\/([^/]+)$/);
      if (getMatch) {
        return callTool("get_action_proposal", { id: getMatch[1] });
      }

      throw new Error(`Unsupported deployment GET path: ${path}`);
    },

    async post(path: string, body?: unknown) {
      const approveMatch = path.match(/^\/action-proposals\/([^/]+)\/approve$/);
      if (approveMatch) {
        return callTool("approve_action_proposal", {
          id: approveMatch[1],
          ...(typeof body === "object" && body !== null ? body : {}),
        });
      }

      const rejectMatch = path.match(/^\/action-proposals\/([^/]+)\/reject$/);
      if (rejectMatch) {
        return callTool("reject_action_proposal", {
          id: rejectMatch[1],
          ...(typeof body === "object" && body !== null ? body : {}),
        });
      }

      throw new Error(`Unsupported deployment POST path: ${path}`);
    },
  };
}
