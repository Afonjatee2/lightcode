import type { ToolCallPayload } from "@/shared/contracts";
import { isSubAgentTool } from "../components/thread/ChatPane/parts/items/toolDisplay";
import { readBridge } from "../bridge";
import { useAppStore } from "./appStore";
import type { CompletedTurnRecord, RuntimeChatItem } from "./slices/runtimeEventSlice";

const FLUSH_DEBOUNCE_MS = 300;

/**
 * Persists per-thread canonical chat items to SQLite so the UI can hydrate
 * after an app restart. Subscribes to runtime item ids / maps, diffs by
 * reference, and debounce-flushes per thread.
 *
 * Designed for "fire-and-forget" persistence: missing a write under heavy
 * load is fine because the next event triggers another flush. We only persist
 * canonical items plus completed-turn markers (not requests) since requests
 * are ephemeral and resolve within a turn.
 */
interface PendingFlush {
  items: RuntimeChatItem[];
  turns: ReadonlyArray<CompletedTurnRecord>;
}

interface CompactedRuntimeItems {
  items: RuntimeChatItem[];
  anchorRemap: ReadonlyMap<string, string | null>;
}

export function prepareRuntimeSnapshotForPersistence(
  items: readonly RuntimeChatItem[],
  turns: ReadonlyArray<CompletedTurnRecord>,
): {
  items: RuntimeChatItem[];
  turns: CompletedTurnRecord[];
} {
  const compacted = compactRuntimeItemsForPersistence(items);
  return {
    items: compacted.items,
    turns: remapCompletedTurnAnchors(turns, compacted.anchorRemap),
  };
}

export function installRuntimeItemsPersister(): () => void {
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, PendingFlush>();

  const scheduleFlush = (threadId: string, payload: PendingFlush) => {
    pending.set(threadId, payload);
    const existing = pendingTimers.get(threadId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingTimers.delete(threadId);
      const snapshot = pending.get(threadId);
      pending.delete(threadId);
      if (!snapshot) return;
      const persisted = prepareRuntimeSnapshotForPersistence(snapshot.items, snapshot.turns);
      const bridge = readBridge();
      void bridge
        .dbReplaceThreadRuntimeSnapshot({
          threadId,
          items: persisted.items.map((item) => ({
            id: item.id,
            type: item.type,
            state: item.state,
            payload: item.payload,
            streams: item.streams as Record<string, string>,
            ...(item.parentItemId ? { parentItemId: item.parentItemId } : {}),
          })),
          turns: persisted.turns.map((turn) => ({
            startedAt: new Date(turn.startedAt).toISOString(),
            endedAt: new Date(turn.endedAt).toISOString(),
            anchorItemId: turn.anchorItemId,
          })),
        })
        .catch((err: unknown) => {
          console.warn("[chat] failed to persist runtime snapshot for thread %s", threadId, err);
        });
    }, FLUSH_DEBOUNCE_MS);
    pendingTimers.set(threadId, timer);
  };

  // Gate the subscriber on `runtimeDirtyThreadIds` reference change so the
  // persister body skips the ~99% of store mutations that aren't runtime
  // events (theme toggles, thread metadata edits, drafts, view changes, …).
  // The slice keeps `runtimeDirtyThreadIds` reference-stable until a runtime
  // event fires (or a turn closes), so reference equality is the right gate.
  const unsubscribe = useAppStore.subscribe(
    (state) => state.runtimeDirtyThreadIds,
    (dirtyThreadIds) => {
      if (dirtyThreadIds.length === 0) return;
      const state = useAppStore.getState();
      for (const threadId of dirtyThreadIds) {
        const ids = state.runtimeItemIdsByThread[threadId];
        const itemsById = state.runtimeItemsByIdByThread[threadId];
        const turns = state.runtimeCompletedTurnsByThread[threadId] ?? [];
        scheduleFlush(threadId, {
          items: (ids ?? [])
            .map((itemId) => itemsById?.[itemId])
            .filter((item): item is RuntimeChatItem => !!item),
          turns,
        });
      }
      useAppStore.getState().clearRuntimeDirtyThreadIds(dirtyThreadIds);
    },
  );

  return () => {
    unsubscribe();
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
    pending.clear();
  };
}

/**
 * Fetch persisted items for a thread and seed the Zustand store. Called on
 * `ChatPane` mount so reopening a thread shows past messages even after an
 * app restart.
 */
export async function hydrateThreadRuntimeItems(threadId: string): Promise<void> {
  const bridge = readBridge();
  const [itemsResult, turnsResult] = await Promise.allSettled([
    Promise.resolve().then(() => bridge.dbGetThreadRuntimeItems(threadId)),
    Promise.resolve().then(() => bridge.dbGetThreadCompletedTurns(threadId)),
  ]);

  if (itemsResult.status === "fulfilled" && itemsResult.value.length > 0) {
    // DB rows are already written in compacted form; rerunning the shared
    // compactor keeps synthetic summary items normalized during hydration.
    const { items } = compactRuntimeItemsForPersistence(
      itemsResult.value.map((row) => ({
        id: row.id,
        type: row.type as RuntimeChatItem["type"],
        state: row.state,
        payload: row.payload,
        streams: row.streams as RuntimeChatItem["streams"],
        ...(row.parentItemId ? { parentItemId: row.parentItemId } : {}),
      })),
    );
    useAppStore.getState().hydrateThreadRuntimeItems(threadId, items);
  } else if (itemsResult.status === "rejected") {
    console.warn(
      "[chat] failed to hydrate runtime items for thread %s",
      threadId,
      itemsResult.reason,
    );
  }

  if (turnsResult.status === "fulfilled" && turnsResult.value.length > 0) {
    const records: CompletedTurnRecord[] = turnsResult.value.flatMap((row) => {
      const startedAt = new Date(row.startedAt).getTime();
      const endedAt = new Date(row.endedAt).getTime();
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return [];
      return [{ startedAt, endedAt, anchorItemId: row.anchorItemId }];
    });
    useAppStore.getState().hydrateThreadCompletedTurns(threadId, records);
  } else if (turnsResult.status === "rejected") {
    console.warn(
      "[chat] failed to hydrate completed turns for thread %s",
      threadId,
      turnsResult.reason,
    );
  }
}

function remapCompletedTurnAnchors(
  turns: ReadonlyArray<CompletedTurnRecord>,
  anchorRemap: ReadonlyMap<string, string | null>,
): CompletedTurnRecord[] {
  return turns.map((turn) => ({
    ...turn,
    anchorItemId: turn.anchorItemId === null ? null : (anchorRemap.get(turn.anchorItemId) ?? null),
  }));
}

function compactRuntimeItemsForPersistence(
  items: readonly RuntimeChatItem[],
): CompactedRuntimeItems {
  const compacted: RuntimeChatItem[] = [];
  const anchorRemap = new Map<string, string | null>();
  let lastPersistedItemId: string | null = null;
  let idx = 0;
  while (idx < items.length) {
    const item = items[idx]!;
    if (isEmptyCompletedReasoning(item)) {
      // If a turn marker was anchored to a row we drop on save, keep it
      // attached to the previous surviving row so it renders in the same gap.
      anchorRemap.set(item.id, lastPersistedItemId);
      idx += 1;
      continue;
    }
    if (!isToolGroupItem(item) || item.state !== "completed") {
      compacted.push(item);
      anchorRemap.set(item.id, item.id);
      lastPersistedItemId = item.id;
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
    const persistedItem =
      run.length === 1 ? normalizeToolSummaryItem(run[0]!) : summarizeToolCallRun(run);
    compacted.push(persistedItem);
    for (const runItem of run) {
      anchorRemap.set(runItem.id, persistedItem.id);
    }
    lastPersistedItemId = persistedItem.id;
  }
  return { items: compacted, anchorRemap };
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

type SummaryCategory = "viewed" | "searched" | "edited" | "executed" | "other";

const CATEGORY_LABELS: Record<SummaryCategory, { singular: string; plural: string }> = {
  viewed: { singular: "view", plural: "views" },
  searched: { singular: "search", plural: "searches" },
  edited: { singular: "edit", plural: "edits" },
  executed: { singular: "command", plural: "commands" },
  other: { singular: "tool", plural: "tools" },
};

const CATEGORY_PRIORITY: Record<SummaryCategory, number> = {
  viewed: 0,
  searched: 1,
  edited: 2,
  executed: 3,
  other: 4,
};

function summarizeToolCallNames(items: readonly RuntimeChatItem[]): string {
  const counts = new Map<SummaryCategory, number>();
  for (const item of items) {
    const category = categorizeItem(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(
    ([aCat, aCount], [bCat, bCount]) =>
      bCount - aCount || CATEGORY_PRIORITY[aCat] - CATEGORY_PRIORITY[bCat],
  );
  const parts = sorted.map(([category, count]) => {
    const meta = CATEGORY_LABELS[category];
    return `${count} ${count === 1 ? meta.singular : meta.plural}`;
  });
  return parts.length > 0 ? parts.join(", ") : `${items.length} tools`;
}

function isToolGroupItem(item: RuntimeChatItem): boolean {
  // Sub-agent parents (e.g. Claude `Task`) carry the final result on their
  // payload; if they got bundled into a tool-call summary the result would be
  // lost and the overlay would have nothing to show after completion.
  if (item.type === "tool_call" && isSubAgentTool(item.payload as ToolCallPayload | undefined)) {
    return false;
  }
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "file_change" ||
    item.type === "web_search"
  );
}

function isEmptyCompletedReasoning(item: RuntimeChatItem): boolean {
  return (
    item.type === "reasoning" &&
    item.state === "completed" &&
    !(item.streams.reasoning_text ?? "").trim()
  );
}

function categorizeItem(item: RuntimeChatItem): SummaryCategory {
  if (item.type === "command_execution") return "executed";
  if (item.type === "file_change") return "edited";
  if (item.type === "web_search") return "searched";
  const payload = item.payload as Partial<ToolCallPayload> | undefined;
  if (!payload) return "other";

  switch (payload.kind) {
    case "read":
      return "viewed";
    case "search":
    case "fetch":
      return "searched";
    case "edit":
    case "delete":
    case "move":
      return "edited";
    case "execute":
      return "executed";
  }

  const byName = categorizeToolName(payload.name ?? "");
  if (byName !== "other") return byName;
  return categorizeVerbPrefix(payload.name ?? "");
}

function categorizeToolName(name: string): SummaryCategory {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "viewed";
    case "Grep":
    case "Glob":
    case "LS":
    case "List":
    case "WebSearch":
    case "WebFetch":
    case "ToolSearch":
      return "searched";
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
    case "Patch":
      return "edited";
    case "Bash":
    case "BashOutput":
    case "KillBash":
    case "KillShell":
      return "executed";
    default:
      return "other";
  }
}

function categorizeVerbPrefix(name: string): SummaryCategory {
  const t = name.toLowerCase().trim();
  if (t.startsWith("viewing") || t.startsWith("reading") || t.startsWith("read ")) return "viewed";
  if (
    t.startsWith("searching") ||
    t.startsWith("finding") ||
    t.startsWith("grep") ||
    t.startsWith("listing") ||
    t.startsWith("fetch")
  ) {
    return "searched";
  }
  if (
    t.startsWith("editing") ||
    t.startsWith("writing") ||
    t.startsWith("patching") ||
    t.startsWith("creating") ||
    t.startsWith("deleting") ||
    t.startsWith("removing")
  ) {
    return "edited";
  }
  if (t.startsWith("running") || t.startsWith("executing") || t.startsWith("shell")) {
    return "executed";
  }
  return "other";
}
