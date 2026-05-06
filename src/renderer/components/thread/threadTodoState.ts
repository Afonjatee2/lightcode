import type { PlanItemPayload } from "@/shared/contracts";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";

export type ThreadTodoStepStatus = PlanItemPayload["steps"][number]["status"];

export interface ThreadTodoStep {
  text: string;
  status: ThreadTodoStepStatus;
}

export interface ThreadTodoDockState {
  sourceItemId: string;
  itemState: RuntimeChatItem["state"];
  steps: readonly ThreadTodoStep[];
  activeIndex: number;
  sourceKind: "steps" | "plan_text";
}

const BULLET_TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[(?<marker>[ xX~>])\]\s+)?(?<text>.+?)\s*$/;
const CHECKBOX_TASK_RE = /^\s*\[(?<marker>[ xX~>])\]\s+(?<text>.+?)\s*$/;

export function selectThreadTodoDockState(
  state: AppStoreState,
  threadId: string,
): ThreadTodoDockState | null {
  const item = selectThreadTodoDockItem(state, threadId);
  return item ? getThreadTodoDockStateForItem(item) : null;
}

export function selectThreadTodoDockItem(
  state: AppStoreState,
  threadId: string,
): RuntimeChatItem | null {
  const itemIds = state.runtimeItemIdsByThread[threadId];
  if (!itemIds?.length) return null;
  const itemsById = state.runtimeItemsByIdByThread[threadId];
  // Walk newest → oldest. If we hit a user_message before any plan, a new turn
  // has started since the last plan was emitted, so suppress the dock.
  for (let index = itemIds.length - 1; index >= 0; index -= 1) {
    const item = itemsById?.[itemIds[index]!];
    if (!item) continue;
    if (item.type === "user_message") return null;
    if (item.type !== "plan") continue;
    if (getThreadTodoDockStateForItem(item)) return item;
  }
  return null;
}

export function getThreadTodoDockStateForItem(item: RuntimeChatItem): ThreadTodoDockState | null {
  if (item.type !== "plan") return null;
  const payload = getRuntimeItemPayload<PlanItemPayload>(item, "plan");
  const stepsFromPayload = normalizePayloadSteps(payload?.steps ?? []);
  if (stepsFromPayload.length > 0) {
    return {
      sourceItemId: item.id,
      itemState: item.state,
      steps: stepsFromPayload,
      activeIndex: resolveActiveIndex(stepsFromPayload),
      sourceKind: "steps",
    };
  }

  const stepsFromText = parsePlanTextSteps(item.streams.plan_text ?? "");
  if (stepsFromText.length === 0) return null;
  return {
    sourceItemId: item.id,
    itemState: item.state,
    steps: stepsFromText,
    activeIndex: resolveActiveIndex(stepsFromText),
    sourceKind: "plan_text",
  };
}

export function parsePlanTextSteps(text: string): ThreadTodoStep[] {
  if (text.trim().length === 0) return [];
  const steps: ThreadTodoStep[] = [];
  for (const rawLine of text.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = BULLET_TASK_RE.exec(line) ?? CHECKBOX_TASK_RE.exec(line);
    if (!match?.groups?.text) continue;
    const taskText = normalizeTaskText(match.groups.text);
    if (taskText.length === 0) continue;
    steps.push({
      text: taskText,
      status: statusFromMarker(match.groups.marker),
    });
  }
  return steps;
}

function normalizePayloadSteps(
  steps: readonly PlanItemPayload["steps"][number][],
): ReadonlyArray<ThreadTodoStep> {
  return steps
    .map((step) => ({
      text: normalizeTaskText(step.step),
      status: step.status,
    }))
    .filter((step) => step.text.length > 0);
}

function normalizeTaskText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function statusFromMarker(marker: string | undefined): ThreadTodoStepStatus {
  if (!marker || marker === " ") return "pending";
  if (marker.toLowerCase() === "x") return "completed";
  return "in_progress";
}

function resolveActiveIndex(steps: readonly ThreadTodoStep[]): number {
  const runningIndex = steps.findIndex((step) => step.status === "in_progress");
  if (runningIndex >= 0) return runningIndex;
  const pendingIndex = steps.findIndex((step) => step.status === "pending");
  if (pendingIndex >= 0) return pendingIndex;
  return Math.max(steps.length - 1, 0);
}
