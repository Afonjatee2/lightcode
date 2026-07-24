import type { McpServer, McpToolCallResult, ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";

export class DeploymentMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentMcpError";
  }
}

/** Normalises renderer MCP tool-call results into raw proposal payloads. */
export function unwrapMcpToolContent(result: McpToolCallResult): unknown {
  if (result.status === "auth-required") {
    throw new DeploymentMcpError("Control Centre needs authorization.");
  }
  if (result.status === "unavailable") {
    throw new DeploymentMcpError(result.error.message);
  }
  if (result.status === "tool-error") {
    throw new DeploymentMcpError(result.message);
  }
  if (typeof result.content === "string") {
    throw new DeploymentMcpError(
      "Control Centre returned a response that was too large or malformed.",
    );
  }
  return result.content;
}

export async function callDeploymentMcpTool(options: {
  server: McpServer;
  projectLocation?: ProjectLocation;
  toolName: string;
  args: unknown;
}): Promise<unknown> {
  const result = await readBridge().callMcpTool({
    server: options.server,
    ...(options.projectLocation ? { projectLocation: options.projectLocation } : {}),
    toolName: options.toolName,
    args: options.args,
  });
  return unwrapMcpToolContent(result);
}
