import { controlCentreOperationsTodaySchema } from "@/shared/contracts/campaign/controlCentreOperationsToday";
import type { OperationsTodayViewModel } from "@/renderer/adapters/campaignViewModels";
import { mapOperationsToday } from "@/renderer/adapters/mapOperationsToday";
import {
  useControlCentreTool,
  type ControlCentreToolState,
} from "./useControlCentreTool";

export type OperationsTodayState = ControlCentreToolState<OperationsTodayViewModel>;

const NO_ARGS = {};

/**
 * Fetches the cross-campaign "today" operations overview from Control
 * Centre via the `get_operations_today` MCP tool (no input). Only
 * meaningful for campaign-purpose projects with a configured Control Centre
 * MCP server — pass `skip: true` for any other project.
 *
 * The wire schema is parsed exactly against CC's contract, then mapped to
 * the UI-friendly view model (with derived counts) via the adapter.
 */
export function useOperationsToday(
  projectId: string | undefined,
  options?: { skip?: boolean },
): OperationsTodayState & { refetch: () => void } {
  const { state, refetch } = useControlCentreTool({
    projectId,
    toolName: "get_operations_today",
    args: NO_ARGS,
    schema: controlCentreOperationsTodaySchema,
    skip: options?.skip ?? false,
  });

  if (state.status === "ready") {
    return { status: "ready", data: mapOperationsToday(state.data), refetch };
  }
  return { ...state, refetch } as OperationsTodayState & { refetch: () => void };
}
