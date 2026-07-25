import { diagnoseControlCentreMcpSetup } from "@/shared/contracts";
import { selectTodayDataProject } from "@/renderer/campaign/resolveTodayDataSource";
import { useOperationsToday } from "@/renderer/hooks/useOperationsToday";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

/** App-level Today home data via campaign project MCP or the global Control Centre server. */
export function useCampaignTodayOperations() {
  const userMcpServers = useSharedSettings((s) => s.mcpServers);
  const globalControlCentreReady = diagnoseControlCentreMcpSetup(userMcpServers).kind === "ready";
  const projectId = useAppStore((state) =>
    selectTodayDataProject(state.projects, userMcpServers, state.threads),
  );
  const useGlobalServer = !projectId && globalControlCentreReady;
  const operationsToday = useOperationsToday(projectId, {
    skip: !projectId && !globalControlCentreReady,
    useGlobalServer,
  });
  return { projectId, globalControlCentreReady, operationsToday };
}
