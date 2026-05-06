import type { FileChangePayload, ToolCallPayload } from "@/shared/contracts";
import { readBridge } from "../bridge";
import { useAppStore } from "./appStore";
import type { RuntimeChatItem } from "./slices/runtimeEventSlice";

const FLUSH_DEBOUNCE_MS = 300;

/**
 * Persists per-thread canonical chat items to SQLite so the UI can hydrate
 * after an app restart. Subscribes to runtime item ids / maps, diffs by
 * reference, and debounce-flushes per thread.
 *
 * Designed for "fire-and-forget" persistence: missing a write under heavy
 * load is fine because the next event triggers another flush. We only
 * persist *items* (not requests) since requests are ephemeral and resolve
 * within a turn.
 */
export function installRuntimeItemsPersister(): () => void {
  let prevItemIdsByThread = useAppStore.getState().runtimeItemIdsByThread;
  let prevItemsByIdByThread = useAppStore.getState().runtimeItemsByIdByThread;
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingItems = new Map<string, RuntimeChatItem[]>();

  const scheduleFlush = (threadId: string, items: RuntimeChatItem[]) => {
    pendingItems.set(threadId, items);
    const existing = pendingTimers.get(threadId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingTimers.delete(threadId);
      const snapshot = pendingItems.get(threadId);
      pendingItems.delete(threadId);
      if (!snapshot) return;
      const persistedItems = compactCompletedToolRuns(snapshot);
      void readBridge()
        .dbReplaceThreadRuntimeItems({
          threadId,
          items: persistedItems.map((item) => ({
            id: item.id,
            type: item.type,
            state: item.state,
            payload: item.payload,
            streams: item.streams as Record<string, string>,
          })),
        })
        .catch((err: unknown) => {
          console.warn("[chat] failed to persist runtime items for thread %s", threadId, err);
        });
    }, FLUSH_DEBOUNCE_MS);
    pendingTimers.set(threadId, timer);
  };

  const unsubscribe = useAppStore.subscribe((state) => {
    const nextIds = state.runtimeItemIdsByThread;
    const nextItemsById = state.runtimeItemsByIdByThread;
    if (nextIds === prevItemIdsByThread && nextItemsById === prevItemsByIdByThread) return;
    for (const threadId of Object.keys(nextIds)) {
      const ids = nextIds[threadId];
      const prevIds = prevItemIdsByThread[threadId];
      const itemsById = nextItemsById[threadId];
      const prevItemsById = prevItemsByIdByThread[threadId];
      if (ids !== prevIds || itemsById !== prevItemsById) {
        scheduleFlush(
          threadId,
          (ids ?? [])
            .map((itemId) => itemsById?.[itemId])
            .filter((item): item is RuntimeChatItem => !!item),
        );
      }
    }
    prevItemIdsByThread = nextIds;
    prevItemsByIdByThread = nextItemsById;
  });

  return () => {
    unsubscribe();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
    pendingItems.clear();
  };
}

/**
 * Fetch persisted items for a thread and seed the Zustand store. Called on
 * `ChatPane` mount so reopening a thread shows past messages even after an
 * app restart.
 */
export async function hydrateThreadRuntimeItems(threadId: string): Promise<void> {
  try {
    const persisted = await readBridge().dbGetThreadRuntimeItems(threadId);
    if (persisted.length === 0) return;
    const items: RuntimeChatItem[] = compactCompletedToolRuns(
      persisted.map((row) => ({
        id: row.id,
        type: row.type as RuntimeChatItem["type"],
        state: row.state,
        payload: row.payload,
        streams: row.streams as RuntimeChatItem["streams"],
      })),
    );
    useAppStore.getState().hydrateThreadRuntimeItems(threadId, items);
  } catch (err) {
    console.warn("[chat] failed to hydrate runtime items for thread %s", threadId, err);
  }
}

function compactCompletedToolRuns(items: readonly RuntimeChatItem[]): RuntimeChatItem[] {
  const compacted: RuntimeChatItem[] = [];
  let idx = 0;
  while (idx < items.length) {
    const item = items[idx]!;
    if (!isToolGroupItem(item) || item.state !== "completed") {
      compacted.push(item);
      idx += 1;
      continue;
    }
    const run: RuntimeChatItem[] = [item];
    idx += 1;
    while (idx < items.length) {
      const next = items[idx]!;
      if (!isToolGroupItem(next) || next.state !== "completed") break;
      run.push(next);
      idx += 1;
    }
    compacted.push(
      run.length === 1 ? normalizeToolSummaryItem(run[0]!) : summarizeToolCallRun(run),
    );
  }
  return compacted;
}

function normalizeToolSummaryItem(item: RuntimeChatItem): RuntimeChatItem {
  if (!item.id.startsWith("tool-call-summary:") || item.type !== "tool_call") return item;
  const payload = item.payload as Partial<ToolCallPayload> | undefined;
  return {
    ...item,
    payload: {
      ...payload,
      name: payload?.name ?? "Tool calls",
      status: "success",
    } satisfies ToolCallPayload,
  };
}

function summarizeToolCallRun(items: readonly RuntimeChatItem[]): RuntimeChatItem {
  const first = items[0]!;
  const last = items[items.length - 1]!;
  return {
    id: `tool-call-summary:${first.id}:${last.id}:${items.length}`,
    type: "tool_call",
    state: "completed",
    payload: {
      name: summarizeToolCallNames(items),
      status: "success",
    } satisfies ToolCallPayload,
    streams: {},
  };
}

function summarizeToolCallNames(items: readonly RuntimeChatItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const category = categorizeItem(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const topCounts = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const parts = topCounts.map(
    ([label, count]) => `${count} ${count === 1 ? label : pluralizeLabel(label)}`,
  );
  const rest = items.length - topCounts.reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0) parts.push(`${rest} other`);
  return `${items.length} tool calls${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

function isToolGroupItem(item: RuntimeChatItem): boolean {
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "web_search"
  );
}

function categorizeItem(item: RuntimeChatItem): string {
  if (item.type === "command_execution") return "command";
  if (item.type === "file_change") return categorizeFileChange(item.payload);
  if (item.type === "web_search") return "search";
  const payload = item.payload as Partial<ToolCallPayload> | undefined;
  return categorizeToolName(payload?.name ?? "");
}

function categorizeFileChange(payload: unknown): string {
  const change = payload as Partial<FileChangePayload> | undefined;
  return change?.changeKind === "delete" ? "delete" : "edit";
}

function categorizeToolName(name: string): string {
  const t = name.toLowerCase().trim();
  if (t.startsWith("viewing") || t.startsWith("reading") || t.startsWith("read ")) return "viewed";
  if (t.startsWith("searching") || t.startsWith("finding") || t.startsWith("grep")) {
    return "search";
  }
  if (t.startsWith("editing") || t.startsWith("writing") || t.startsWith("patching")) {
    return "edit";
  }
  if (t.startsWith("running") || t.startsWith("executing") || t.startsWith("shell")) {
    return "command";
  }
  return "tool";
}

function pluralizeLabel(label: string): string {
  if (label === "search") return "searches";
  if (label === "viewed") return "viewed";
  return `${label}s`;
}
