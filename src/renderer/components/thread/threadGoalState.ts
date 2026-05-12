import type { GoalItemPayload, GoalStatus } from "@/shared/contracts";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";

export interface ThreadGoalDockState {
  sourceItemId: string;
  itemState: RuntimeChatItem["state"];
  objective: string;
  status: GoalStatus;
  action: GoalItemPayload["action"];
  tokenBudget?: number | null;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  updatedAt?: number;
}

interface ThreadGoalCandidate {
  item: RuntimeChatItem;
  payload: GoalItemPayload;
}

export function selectThreadGoalDockState(
  state: AppStoreState,
  threadId: string,
): ThreadGoalDockState | null {
  return getThreadGoalDockStateFromThreadItems(
    state.runtimeItemIdsByThread[threadId],
    state.runtimeItemsByIdByThread[threadId],
  );
}

export function getThreadGoalDockStateFromThreadItems(
  itemIds: readonly string[] | undefined,
  itemsById: AppStoreState["runtimeItemsByIdByThread"][string] | undefined,
): ThreadGoalDockState | null {
  const latest = selectLatestThreadGoalCandidate(itemIds, itemsById);
  if (!latest) return null;

  const { item, payload } = latest;
  if (payload.action === "cleared") return null;

  const objective = normalizeObjective(payload.objective);
  if (!objective) return null;

  return {
    sourceItemId: item.id,
    itemState: item.state,
    objective,
    status: payload.status ?? "active",
    action: payload.action,
    ...(payload.tokenBudget !== undefined ? { tokenBudget: payload.tokenBudget } : {}),
    ...(payload.tokensUsed !== undefined ? { tokensUsed: payload.tokensUsed } : {}),
    ...(payload.timeUsedSeconds !== undefined ? { timeUsedSeconds: payload.timeUsedSeconds } : {}),
    ...(payload.updatedAt !== undefined ? { updatedAt: payload.updatedAt } : {}),
  };
}

function selectLatestThreadGoalCandidate(
  itemIds: readonly string[] | undefined,
  itemsById: AppStoreState["runtimeItemsByIdByThread"][string] | undefined,
): ThreadGoalCandidate | null {
  if (!itemIds?.length) return null;
  for (let index = itemIds.length - 1; index >= 0; index -= 1) {
    const item = itemsById?.[itemIds[index]!];
    if (!item || item.type !== "goal") continue;
    const payload = getRuntimeItemPayload<GoalItemPayload>(item, "goal");
    if (!payload) continue;
    return { item, payload };
  }
  return null;
}

function normalizeObjective(objective: string | undefined): string {
  return (objective ?? "").replace(/\s+/g, " ").trim();
}
