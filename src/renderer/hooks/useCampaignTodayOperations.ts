import { useShallow } from "zustand/shallow";
import { selectTodayDataProject } from "@/renderer/campaign/resolveTodayDataSource";
import { useOperationsToday } from "@/renderer/hooks/useOperationsToday";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

/** App-level Today home data via the most recently active campaign project's MCP config. */
export function useCampaignTodayOperations() {
  const userMcpServers = useSharedSettings((s) => s.mcpServers);
  const projectId = useAppStore(
    useShallow((state) => selectTodayDataProject(state.projects, userMcpServers, state.threads)),
  );
  const operationsToday = useOperationsToday(projectId, { skip: !projectId });
  return { projectId, operationsToday };
}
