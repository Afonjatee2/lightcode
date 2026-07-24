import {
  ControlCentreClient,
  FixtureDeploymentClient,
  createMcpDeploymentTransport,
} from "@/shared/campaignDeployment";
import type { ControlCentreDeploymentClient } from "@/shared/campaignDeployment";
import { useProject } from "@/renderer/state/useThread";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveControlCentreServer } from "@/renderer/hooks/useControlCentreTool";
import { callDeploymentMcpTool } from "./callDeploymentMcpTool";

/**
 * Returns a Control Centre deployment client for the given campaign project.
 * Production path: MCP tools via the supervisor `callMcpTool` bridge.
 * Test/dev path: in-memory `FixtureDeploymentClient`.
 */
export function useDeploymentClient(
  projectId: string | undefined,
  _campaignGroupId: string | undefined,
  options: {
    useFixture?: boolean;
    fixtureSeed?: Parameters<FixtureDeploymentClient["seed"]>[0];
  } = {},
): ControlCentreDeploymentClient | null {
  const project = useProject(projectId);
  const userMcpServers = useSharedSettings((s) => s.mcpServers);
  const useFixture = options.useFixture ?? false;
  const seed = options.fixtureSeed;

  if (useFixture) {
    const client = new FixtureDeploymentClient();
    if (seed !== undefined && seed.length > 0) {
      client.seed(seed);
    }
    return client;
  }

  const server = resolveControlCentreServer(project, userMcpServers);
  if (!server) return null;

  const transport = createMcpDeploymentTransport((toolName, args) =>
    callDeploymentMcpTool({
      server,
      ...(project?.location ? { projectLocation: project.location } : {}),
      toolName,
      args,
    }),
  );

  return new ControlCentreClient({ transport });
}
