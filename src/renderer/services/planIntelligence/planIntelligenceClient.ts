import type { McpServer, Project, ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { unwrapMcpToolContent } from "@/renderer/services/campaignDeployment/callDeploymentMcpTool";

export async function callPlanIntelligenceMcpTool(options: {
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

export function projectLocationFromProject(
  project: Project | undefined,
): ProjectLocation | undefined {
  return project?.location;
}
