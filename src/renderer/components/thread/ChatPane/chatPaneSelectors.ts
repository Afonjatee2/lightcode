import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import type { AppStoreState } from "@/renderer/state/slices/shared";

export const EMPTY_THREAD_ITEM_IDS = Object.freeze([]) as readonly string[];
export const EMPTY_THREAD_TIMELINE_ENTRIES = Object.freeze([]) as readonly ChatTimelineEntry[];

export type ChatTimelineEntry =
  | { kind: "item"; id: string }
  | { kind: "tool_call_group"; id: string; itemIds: readonly string[] };

const timelineEntryCache = new Map<string, readonly ChatTimelineEntry[]>();

export function selectThreadRuntimeItemIds(
  state: AppStoreState,
  threadId: string,
): readonly string[] {
  return state.runtimeItemIdsByThread[threadId] ?? EMPTY_THREAD_ITEM_IDS;
}

export function selectVisibleThreadRuntimeItemIds(
  state: AppStoreState,
  threadId: string,
  hiddenItemId?: string,
): readonly string[] {
  const itemIds = state.runtimeItemIdsByThread[threadId];
  if (!itemIds?.length) return EMPTY_THREAD_ITEM_IDS;
  const items = state.runtimeItemsByIdByThread[threadId];
  const hiddenItem = hiddenItemId ? items?.[hiddenItemId] : undefined;
  const visible = itemIds.filter((itemId) => {
    if (itemId === hiddenItemId) return false;
    const item = items?.[itemId];
    if (hiddenItem?.type === "plan" && item?.type === "plan") return false;
    return item ? isVisibleRuntimeItem(item) : true;
  });
  if (visible.length === 0) return EMPTY_THREAD_ITEM_IDS;
  return visible.length === itemIds.length ? itemIds : visible;
}

export function selectVisibleThreadTimelineEntries(
  state: AppStoreState,
  threadId: string,
  hiddenItemId?: string,
): readonly ChatTimelineEntry[] {
  const itemIds = selectVisibleThreadRuntimeItemIds(state, threadId, hiddenItemId);
  if (itemIds.length === 0) return EMPTY_THREAD_TIMELINE_ENTRIES;
  const items = state.runtimeItemsByIdByThread[threadId];
  const cacheKey = [
    threadId,
    hiddenItemId ?? "",
    ...itemIds.map((itemId) => `${itemId}:${items?.[itemId]?.type ?? ""}`),
  ].join("\0");
  const cached = timelineEntryCache.get(cacheKey);
  if (cached) return cached;
  const entries: ChatTimelineEntry[] = [];
  let idx = 0;
  while (idx < itemIds.length) {
    const itemId = itemIds[idx]!;
    const item = items?.[itemId];
    if (!item || !isToolGroupItem(item)) {
      entries.push({ kind: "item", id: itemId });
      idx += 1;
      continue;
    }
    const groupIds: string[] = [itemId];
    idx += 1;
    while (idx < itemIds.length) {
      const nextId = itemIds[idx]!;
      const next = items?.[nextId];
      if (!next || !isToolGroupItem(next)) break;
      groupIds.push(nextId);
      idx += 1;
    }
    if (groupIds.length === 1) {
      entries.push({ kind: "item", id: itemId });
    } else {
      entries.push({
        kind: "tool_call_group",
        id: `tool-call-group:${groupIds[0]}:${groupIds[groupIds.length - 1]}:${groupIds.length}`,
        itemIds: groupIds,
      });
    }
  }
  if (timelineEntryCache.size > 500) timelineEntryCache.clear();
  timelineEntryCache.set(cacheKey, entries);
  return entries;
}

function isToolGroupItem(item: RuntimeChatItem): boolean {
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "web_search"
  );
}

export function selectThreadHasLiveVisibleRuntimeItem(
  state: AppStoreState,
  threadId: string,
  hiddenItemId?: string,
): boolean {
  const itemIds = state.runtimeItemIdsByThread[threadId];
  if (!itemIds?.length) return false;
  const items = state.runtimeItemsByIdByThread[threadId];
  const hiddenItem = hiddenItemId ? items?.[hiddenItemId] : undefined;
  return itemIds.some((itemId) => {
    if (itemId === hiddenItemId) return false;
    const item = items?.[itemId];
    if (hiddenItem?.type === "plan" && item?.type === "plan") return false;
    return item ? isVisibleRuntimeItem(item) && item.state !== "completed" : false;
  });
}

/**
 * Bumps when the tail of the thread grows (streaming text/output) so the chat
 * pane can re-stick scroll to the bottom without re-rendering on every row.
 */
export function selectChatScrollAnchor(state: AppStoreState, threadId: string): string {
  return selectChatScrollAnchorForTimeline(state, threadId);
}

export function selectChatScrollAnchorForTimeline(
  state: AppStoreState,
  threadId: string,
  hiddenItemId?: string,
): string {
  const itemIds = state.runtimeItemIdsByThread[threadId];
  if (!itemIds?.length) return "";
  const items = state.runtimeItemsByIdByThread[threadId];
  const hiddenItem = hiddenItemId ? items?.[hiddenItemId] : undefined;
  const lastId = [...itemIds].reverse().find((itemId) => {
    if (itemId === hiddenItemId) return false;
    const item = items?.[itemId];
    if (hiddenItem?.type === "plan" && item?.type === "plan") return false;
    return item ? isVisibleRuntimeItem(item) : true;
  });
  if (!lastId) return "";
  const last = items?.[lastId];
  if (!last) return "";
  const streamLen =
    (last.streams.assistant_text?.length ?? 0) +
    (last.streams.reasoning_text?.length ?? 0) +
    (last.streams.plan_text?.length ?? 0) +
    (last.streams.command_output?.length ?? 0) +
    (last.streams.file_change_output?.length ?? 0);
  return `${last.id}:${streamLen}:${last.state}`;
}

function isVisibleRuntimeItem(_item: RuntimeChatItem): boolean {
  // Reasoning items stay in the timeline after completion so the user can
  // expand them later — the `Reasoning` component renders a collapsed
  // "Thought" disclosure for completed items with text. Empty completed
  // reasoning is hidden by `Reasoning` itself, not filtered here, since
  // emptiness is recomputed on every chunk and would churn this selector.
  return true;
}

/** O(1) for the common case (last row is streaming target). */
export function selectRuntimeItemById(
  state: AppStoreState,
  threadId: string,
  itemId: string,
): RuntimeChatItem | undefined {
  return state.runtimeItemsByIdByThread[threadId]?.[itemId];
}

const runtimeItemStoreSelectorCache = new Map<
  string,
  (state: AppStoreState) => RuntimeChatItem | undefined
>();

/**
 * Stable Zustand selector per `(threadId, itemId)` so `useSyncExternalStore`
 * keeps a consistent `getSnapshot` identity across parent-driven renders
 * (virtual row `translateY`, disclosure measure churn).
 */
export function getRuntimeItemStoreSelector(
  threadId: string,
  itemId: string,
): (state: AppStoreState) => RuntimeChatItem | undefined {
  const key = `${threadId}\0${itemId}`;
  let sel = runtimeItemStoreSelectorCache.get(key);
  if (!sel) {
    sel = (state) => selectRuntimeItemById(state, threadId, itemId);
    runtimeItemStoreSelectorCache.set(key, sel);
  }
  return sel;
}
