/**
 * @file DEV-ONLY project seed for Phase 3 campaign workspace acceptance tests.
 *
 * Seeds the app store with a complete Phase 3 campaign project and a campaign
 * GUI thread, using the real `appStore` APIs everywhere possible (the Zustand
 * store's `addProject` and direct state manipulation).
 *
 * ## What it creates
 *
 * 1. A campaign-purpose project with valid `campaignExtension` containing:
 *    - campaignGroupId
 *    - clientName
 *    - campaignName
 *    - jobNumber
 *    - defaultAgentKind, defaultModel
 *    - mcpProfile
 * 2. A configured `control-centre` MCP server pointing at the fixture server.
 *
 * ## Usage
 *
 * ```ts
 * import { seedCampaignProject } from "@/tests/campaign-acceptance/seedCampaignProject";
 * const projectId = await seedCampaignProject();
 * ```
 *
 * REMOVAL: This is a Phase 3 acceptance-only fixture. Remove it when the
 * shared Phase 4 persistence migration (which adds the real end-user project
 * creation flow) is integrated and real campaign projects can be created
 * through the production path.
 *
 * @deprecated Phase 3 acceptance — do not use in production code paths.
 */
import type { McpProfile, McpServer } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

/** Creates a control-centre MCP server descriptor for the fixture server. */
export function buildFixtureMcpServer(
  command: string = "node",
  args: string[] = [],
  env: Record<string, string> = {},
): McpServer {
  return {
    id: "cc-fixture-1",
    name: "control-centre",
    description: "Campaign acceptance fixture server",
    enabled: true,
    timeoutMs: 30_000,
    transport: {
      type: "stdio",
      command,
      args,
      env: {
        CONTROL_CENTRE_MCP_PROFILE: "monitoring",
        ...env,
      },
    },
  };
}

/**
 * Seeds the renderer app store with a complete campaign project.
 *
 * Uses the real `addProject` API when possible, then patches the purpose and
 * campaignExtension fields through direct store manipulation.
 *
 * @param options Optional overrides for the campaign project fields.
 * @returns The project ID of the newly created campaign project.
 */
export function seedCampaignProject(
  options: {
    campaignGroupId?: string;
    clientName?: string;
    campaignName?: string;
    jobNumber?: string;
    defaultAgentKind?: string;
    defaultModel?: string;
    mcpProfile?:
      | "monitoring"
      | "plan_revision"
      | "client_comms"
      | "deployment"
      | "development"
      | undefined;
    /** Path to the fixture MCP server script. */
    fixtureMcpScript?: string;
    /** Fixture MCP server args. */
    fixtureMcpArgs?: string[];
    /** Fixture MCP profile override. If not set, uses mcpProfile. */
    fixtureProfile?: string;
  } = {},
): string {
  const store = useAppStore.getState();
  const location = { kind: "posix" as const, path: "/tmp/campaign-acceptance" };

  // Create a base project via the real API
  const project = store.addProject(location, options.campaignName ?? "Campaign Acceptance Test");

  // Patch the project to be a campaign project
  const campaignMcpProfile = options.mcpProfile ?? "monitoring";
  const fixtureProfile = options.fixtureProfile ?? campaignMcpProfile;

  const mcpServers = options.fixtureMcpScript
    ? [
        buildFixtureMcpServer("node", options.fixtureMcpArgs ?? [options.fixtureMcpScript], {
          CONTROL_CENTRE_MCP_PROFILE: fixtureProfile,
        }),
      ]
    : [
        {
          id: "cc-fixture-1",
          name: "control-centre",
          description: "Campaign acceptance fixture server (stdio)",
          enabled: true,
          timeoutMs: 30_000,
          transport: {
            type: "stdio",
            command: "node",
            args: options.fixtureMcpArgs ?? [],
            env: { CONTROL_CENTRE_MCP_PROFILE: fixtureProfile },
          },
        } satisfies McpServer,
      ];

  // Use the real store update APIs where available
  useAppStore.setState((state) => ({
    projects: state.projects.map((p) => {
      if (p.id !== project.id) return p;
      return {
        ...p,
        purpose: "campaign" as const,
        campaignExtension: {
          campaignGroupId: options.campaignGroupId ?? "group-f3d2d0d9-97c4-4ace-8b68-960d4b27470b",
          clientName: options.clientName ?? "Acceptance Client",
          campaignName: options.campaignName ?? "Phase 3 Campaign Workspace",
          jobNumber: options.jobNumber ?? "ACCEPT-2026-PHASE3-01",
          defaultAgentKind: options.defaultAgentKind ?? "claude",
          defaultModel: options.defaultModel ?? "claude-sonnet-5",
          mcpProfile: campaignMcpProfile as McpProfile | undefined,
          resourceAliases: {
            "@media-plans": "//shared/drive/campaign-media-plans",
          },
        },
        mcpServers,
      };
    }),
  }));

  return project.id;
}

/**
 * Resets the app store to an empty state (no projects, no threads).
 * Use this between acceptance test permutations to avoid state leakage.
 */
export function resetAppStore(): void {
  useAppStore.setState({
    projects: [],
    threads: [],
    view: { kind: "home" },
  });
  useSharedSettings.setState({ mcpServers: [] });
}
