import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import type { AppStoreState } from "@/renderer/state/slices/shared";
import { isContextCompactionToolCall } from "./parts/items/ContextCompaction";

export const EMPTY_THREAD_ITEM_IDS = Object.freeze([]) as readonly string[];
export const EMPTY_THREAD_TIMELINE_ENTRIES = Object.freeze([]) as readonly ChatTimelineEntry[];

export type ChatTimelineEntry =
  | { kind: "item"; id: string }
  | { kind: "tool_call_group"; id: string; itemIds: readonly string[] };

/**
 * Cache for `selectVisibleThreadTimelineEntries`. Keyed by
 * `${threadId}\0${hiddenItemId ?? ""}` (a small constant-size string) and
 * validated in O(1) by reference-comparing the source `itemIds` array and the
 * thread's structural version. The structural version (maintained by
 * `runtimeEventSlice`) bumps only on grouping-affecting changes — content
 * deltas don't invalidate the cache.
 *
 * Zustand re-runs every subscriber's selector on every `set()`. With 8 GUI
 * panes mounted and ~500 streaming events/sec, this selector is one of the
 * hottest read paths in the app; the previous O(N) string-concat cache key
 * (one entry per item, full id+type) was burning real CPU.
 */
const timelineEntryCache = new Map<
  string,
  {
    itemIds: readonly string[];
    structuralVersion: number;
    entries: readonly ChatTimelineEntry[];
  }
>();

/**
 * Cache for `selectVisibleThreadRuntimeItemIds`. The base `itemIds` array is
 * already reference-stable per thread, but the filtered result for the
 * `hiddenItemId !== undefined` case is freshly allocated on every call. We
 * memoize so the timeline cache above can rely on a stable `itemIds`
 * reference even when a thread is rendering a pinned/floating item surface.
 */
const visibleItemIdsCache = new Map<
  string,
  {
    sourceItemIds: readonly string[];
    structuralVersion: number;
    result: readonly string[];
  }
>();

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

  const structuralVersion = state.runtimeStructuralVersionByThread?.[threadId] ?? 0;
  const cacheKey = `${threadId}\0${hiddenItemId ?? ""}`;
  const cached = visibleItemIdsCache.get(cacheKey);
  if (
    cached &&
    cached.sourceItemIds === itemIds &&
    cached.structuralVersion === structuralVersion
  ) {
    return cached.result;
  }

  const items = state.runtimeItemsByIdByThread[threadId];
  const visible = itemIds.filter((itemId) => {
    if (itemId === hiddenItemId) return false;
    const item = items?.[itemId];
    return item ? isVisibleRuntimeItem(item) : true;
  });
  const result =
    visible.length === 0
      ? EMPTY_THREAD_ITEM_IDS
      : visible.length === itemIds.length
        ? itemIds
        : visible;

  if (visibleItemIdsCache.size > 500) visibleItemIdsCache.clear();
  visibleItemIdsCache.set(cacheKey, { sourceItemIds: itemIds, structuralVersion, result });
  return result;
}

export function selectVisibleThreadTimelineEntries(
  state: AppStoreState,
  threadId: string,
  hiddenItemId?: string,
): readonly ChatTimelineEntry[] {
  const itemIds = selectVisibleThreadRuntimeItemIds(state, threadId, hiddenItemId);
  if (itemIds.length === 0) return EMPTY_THREAD_TIMELINE_ENTRIES;

  const structuralVersion = state.runtimeStructuralVersionByThread?.[threadId] ?? 0;
  const cacheKey = `${threadId}\0${hiddenItemId ?? ""}`;
  const cached = timelineEntryCache.get(cacheKey);
  if (cached && cached.itemIds === itemIds && cached.structuralVersion === structuralVersion) {
    return cached.entries;
  }

  const items = state.runtimeItemsByIdByThread[threadId];
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
  timelineEntryCache.set(cacheKey, { itemIds, structuralVersion, entries });
  return entries;
}

function isToolGroupItem(item: RuntimeChatItem): boolean {
  if (isContextCompactionToolCall(item)) return false;
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "web_search"
  );
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
  const lastId = [...itemIds].reverse().find((itemId) => {
    if (itemId === hiddenItemId) return false;
    const item = items?.[itemId];
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

function isVisibleRuntimeItem(item: RuntimeChatItem): boolean {
  // Plans are rendered exclusively in the todo dock — never inline in chat,
  // even after they retire (e.g. all steps completed). Empty completed
  // reasoning items are already dropped at the data layer.
  if (item.type === "plan") return false;
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

export function clearRuntimeItemStoreSelectorCacheForThread(threadId: string): void {
  const prefix = `${threadId}\0`;
  for (const key of runtimeItemStoreSelectorCache.keys()) {
    if (key.startsWith(prefix)) {
      runtimeItemStoreSelectorCache.delete(key);
    }
  }
  for (const key of timelineEntryCache.keys()) {
    if (key.startsWith(prefix)) timelineEntryCache.delete(key);
  }
  for (const key of visibleItemIdsCache.keys()) {
    if (key.startsWith(prefix)) visibleItemIdsCache.delete(key);
  }
}
