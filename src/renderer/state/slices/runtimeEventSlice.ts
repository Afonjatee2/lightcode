import type {
  CanonicalItemType,
  CanonicalRequestType,
  RequestPayload,
  RuntimeContentStreamKind,
  RuntimeEvent,
} from "@/shared/contracts";
import type { AppStoreState, SliceCreator } from "./shared";

/** Per-thread record of canonical chat items, derived from RuntimeEvent streams. */
export interface RuntimeChatItem {
  id: string;
  type: CanonicalItemType;
  /** "started" / "updated" land on items that haven't ended yet; "completed" → final. */
  state: "started" | "updated" | "completed";
  /** Last payload object reported via `item.started` or `item.updated`. */
  payload?: unknown;
  /** Streamed content buckets (markdown text, command output, etc.). */
  streams: Partial<Record<RuntimeContentStreamKind, string>>;
}

export interface OpenRuntimeRequest {
  requestId: string;
  threadId: string;
  requestType: CanonicalRequestType;
  payload: RequestPayload;
  receivedAt: string;
}

export interface RuntimeEventSlice {
  /** Append-only ordered item ids per thread (newest at the end). */
  runtimeItemIdsByThread: Record<string, readonly string[]>;
  /** O(1) item lookup by id for each thread. */
  runtimeItemsByIdByThread: Record<string, Record<string, RuntimeChatItem>>;
  /** Open approval / user-input requests per thread. */
  runtimeRequestsByThread: Record<string, OpenRuntimeRequest[]>;
  /** Thread ids with runtime item changes waiting for persistence. */
  runtimeDirtyThreadIds: readonly string[];
  /**
   * Per-thread monotonic counter that bumps only on grouping-affecting changes
   * (item add/remove/payload mutation). Excludes `content.delta` so that
   * streaming text does not invalidate cached timeline groupings. Selectors
   * (e.g. `selectVisibleThreadTimelineEntries`) use this for O(1) cache
   * validation instead of recomputing a per-item fingerprint on every read.
   */
  runtimeStructuralVersionByThread: Record<string, number>;
  applyRuntimeEvent(threadId: string, event: RuntimeEvent): void;
  applyRuntimeEvents(threadId: string, events: RuntimeEvent[]): void;
  clearRuntimeDirtyThreadIds(threadIds: readonly string[]): void;
  clearThreadRuntimeEvents(threadId: string): void;
  /** Replace the persisted item list for a thread (used during DB hydration). */
  hydrateThreadRuntimeItems(threadId: string, items: RuntimeChatItem[]): void;
}

/**
 * Typed accessor for a runtime item's payload. Returns `undefined` when the
 * item is the wrong canonical type, so chat-part components can treat the
 * cast as validated rather than blind.
 */
export function getRuntimeItemPayload<T>(
  item: RuntimeChatItem,
  expectedType: CanonicalItemType,
): T | undefined {
  return item.type === expectedType ? (item.payload as T | undefined) : undefined;
}

export const createRuntimeEventSlice: SliceCreator<RuntimeEventSlice> = (set) => ({
  runtimeItemIdsByThread: {},
  runtimeItemsByIdByThread: {},
  runtimeRequestsByThread: {},
  runtimeDirtyThreadIds: [],
  runtimeStructuralVersionByThread: {},

  applyRuntimeEvent: (threadId, event) =>
    set((state) => applyRuntimeEventsToState(state, threadId, [event])),

  applyRuntimeEvents: (threadId, events) =>
    set((state) => applyRuntimeEventsToState(state, threadId, events)),

  clearRuntimeDirtyThreadIds: (threadIds) =>
    set((state) => {
      if (threadIds.length === 0 || state.runtimeDirtyThreadIds.length === 0) return {};
      const dropped = new Set(threadIds);
      const runtimeDirtyThreadIds = state.runtimeDirtyThreadIds.filter((id) => !dropped.has(id));
      return runtimeDirtyThreadIds.length === state.runtimeDirtyThreadIds.length
        ? {}
        : { runtimeDirtyThreadIds };
    }),

  clearThreadRuntimeEvents: (threadId) =>
    set((state) => {
      if (
        !(threadId in state.runtimeItemIdsByThread) &&
        !(threadId in state.runtimeItemsByIdByThread) &&
        !(threadId in state.runtimeRequestsByThread)
      ) {
        return {};
      }
      const { [threadId]: _droppedItemIds, ...runtimeItemIdsByThread } =
        state.runtimeItemIdsByThread;
      const { [threadId]: _droppedItems, ...runtimeItemsByIdByThread } =
        state.runtimeItemsByIdByThread;
      const { [threadId]: _droppedReqs, ...runtimeRequestsByThread } =
        state.runtimeRequestsByThread;
      const { [threadId]: _droppedVersion, ...runtimeStructuralVersionByThread } =
        state.runtimeStructuralVersionByThread;
      return {
        runtimeItemIdsByThread,
        runtimeItemsByIdByThread,
        runtimeRequestsByThread,
        runtimeStructuralVersionByThread,
      };
    }),

  hydrateThreadRuntimeItems: (threadId, items) =>
    set((state) => {
      // Don't clobber items that already streamed in for an active thread —
      // the live stream is the source of truth, the DB is only the seed.
      if ((state.runtimeItemIdsByThread[threadId]?.length ?? 0) > 0) return {};
      const itemIds = items.map((item) => item.id);
      const itemsById = Object.fromEntries(items.map((item) => [item.id, item]));
      return {
        runtimeItemIdsByThread: {
          ...state.runtimeItemIdsByThread,
          [threadId]: itemIds,
        },
        runtimeItemsByIdByThread: {
          ...state.runtimeItemsByIdByThread,
          [threadId]: itemsById,
        },
        runtimeStructuralVersionByThread: {
          ...state.runtimeStructuralVersionByThread,
          [threadId]: (state.runtimeStructuralVersionByThread[threadId] ?? 0) + 1,
        },
      };
    }),
});

type RuntimeEventState = Pick<
  RuntimeEventSlice,
  | "runtimeItemIdsByThread"
  | "runtimeItemsByIdByThread"
  | "runtimeRequestsByThread"
  | "runtimeDirtyThreadIds"
  | "runtimeStructuralVersionByThread"
>;

function applyRuntimeEventsToState(
  state: AppStoreState,
  threadId: string,
  events: RuntimeEvent[],
): Partial<RuntimeEventState> {
  let nextState: RuntimeEventState = {
    runtimeItemIdsByThread: state.runtimeItemIdsByThread,
    runtimeItemsByIdByThread: state.runtimeItemsByIdByThread,
    runtimeRequestsByThread: state.runtimeRequestsByThread,
    runtimeDirtyThreadIds: state.runtimeDirtyThreadIds,
    runtimeStructuralVersionByThread: state.runtimeStructuralVersionByThread,
  };
  let changed = false;
  let bumpStructural = false;

  for (const event of coalesceRuntimeEvents(events)) {
    const patch = applyRuntimeEventToRuntimeState(nextState, threadId, event);
    if (Object.keys(patch).length === 0) continue;
    nextState = { ...nextState, ...patch };
    changed = true;
    if (eventAffectsStructuralVersion(event)) bumpStructural = true;
  }

  if (!changed) return {};
  if (bumpStructural) {
    nextState = {
      ...nextState,
      runtimeStructuralVersionByThread: {
        ...nextState.runtimeStructuralVersionByThread,
        [threadId]: (nextState.runtimeStructuralVersionByThread[threadId] ?? 0) + 1,
      },
    };
  }
  return {
    ...nextState,
    runtimeDirtyThreadIds: nextState.runtimeDirtyThreadIds.includes(threadId)
      ? nextState.runtimeDirtyThreadIds
      : [...nextState.runtimeDirtyThreadIds, threadId],
  };
}

/**
 * Grouping decisions in the timeline depend on item identity, type, and
 * (for tool calls) `payload.name`. None of those change during `content.delta`
 * or request events, so the timeline cache stays valid through pure streaming.
 * Everything else conservatively bumps the version.
 */
function eventAffectsStructuralVersion(event: RuntimeEvent): boolean {
  switch (event.type) {
    case "item.started":
    case "item.updated":
    case "item.completed":
    case "error":
      return true;
    default:
      return false;
  }
}

function applyRuntimeEventToRuntimeState(
  state: RuntimeEventState,
  threadId: string,
  event: RuntimeEvent,
): Partial<RuntimeEventState> {
  switch (event.type) {
    case "session.started":
    case "session.exited":
    case "turn.started":
    case "turn.completed":
    case "warning":
      // No item state to mutate. Status flows through the existing thread-state channel.
      return {};

    case "item.started": {
      const existingIds = state.runtimeItemIdsByThread[threadId] ?? [];
      const existingItems = state.runtimeItemsByIdByThread[threadId] ?? {};
      if (existingItems[event.itemId]) return {};
      const item: RuntimeChatItem = {
        id: event.itemId,
        type: event.itemType,
        state: "started",
        payload: event.payload,
        streams: {},
      };
      return {
        runtimeItemIdsByThread: {
          ...state.runtimeItemIdsByThread,
          [threadId]: [...existingIds, event.itemId],
        },
        runtimeItemsByIdByThread: {
          ...state.runtimeItemsByIdByThread,
          [threadId]: { ...existingItems, [event.itemId]: item },
        },
      };
    }

    case "item.updated": {
      const items = state.runtimeItemsByIdByThread[threadId];
      const prev = items?.[event.itemId];
      if (!prev || !items) return {};
      const next: RuntimeChatItem = {
        ...prev,
        state: prev.state === "completed" ? "completed" : "updated",
        payload: mergePayload(prev.payload, event.payload),
      };
      return {
        runtimeItemsByIdByThread: {
          ...state.runtimeItemsByIdByThread,
          [threadId]: { ...items, [event.itemId]: next },
        },
      };
    }

    case "item.completed": {
      const items = state.runtimeItemsByIdByThread[threadId];
      const prev = items?.[event.itemId];
      if (!prev || !items) return {};
      const next: RuntimeChatItem = {
        ...prev,
        state: "completed",
        payload:
          event.payload !== undefined ? mergePayload(prev.payload, event.payload) : prev.payload,
      };
      // A reasoning item that completes with no streamed text is a bracket
      // some agents emit before producing nothing — keeping it in the
      // timeline would split otherwise-adjacent tool calls into separate
      // groups. Drop it from the data so grouping naturally fuses them.
      if (next.type === "reasoning" && !(next.streams.reasoning_text ?? "").trim()) {
        const ids = state.runtimeItemIdsByThread[threadId];
        if (!ids) return {};
        const { [event.itemId]: _dropped, ...remaining } = items;
        return {
          runtimeItemIdsByThread: {
            ...state.runtimeItemIdsByThread,
            [threadId]: ids.filter((id) => id !== event.itemId),
          },
          runtimeItemsByIdByThread: {
            ...state.runtimeItemsByIdByThread,
            [threadId]: remaining,
          },
        };
      }
      return {
        runtimeItemsByIdByThread: {
          ...state.runtimeItemsByIdByThread,
          [threadId]: { ...items, [event.itemId]: next },
        },
      };
    }

    case "content.delta": {
      const items = state.runtimeItemsByIdByThread[threadId];
      const prev = items?.[event.itemId];
      if (!prev || !items) return {};
      const prevStream = prev.streams[event.stream] ?? "";
      const next: RuntimeChatItem = {
        ...prev,
        state: prev.state === "completed" ? "completed" : "updated",
        streams: { ...prev.streams, [event.stream]: mergeStreamChunk(prevStream, event.delta) },
      };
      return {
        runtimeItemsByIdByThread: {
          ...state.runtimeItemsByIdByThread,
          [threadId]: { ...items, [event.itemId]: next },
        },
      };
    }

    case "request.opened": {
      const existing = state.runtimeRequestsByThread[threadId] ?? [];
      const filtered = existing.filter((r) => r.requestId !== event.requestId);
      const open: OpenRuntimeRequest = {
        requestId: event.requestId,
        threadId,
        requestType: event.requestType,
        payload: event.payload,
        receivedAt: new Date().toISOString(),
      };
      return {
        runtimeRequestsByThread: {
          ...state.runtimeRequestsByThread,
          [threadId]: [...filtered, open],
        },
      };
    }

    case "request.resolved": {
      const list = state.runtimeRequestsByThread[threadId];
      if (!list) return {};
      const next = list.filter((r) => r.requestId !== event.requestId);
      if (next.length === list.length) return {};
      return {
        runtimeRequestsByThread: {
          ...state.runtimeRequestsByThread,
          [threadId]: next,
        },
      };
    }

    case "error": {
      const existingIds = state.runtimeItemIdsByThread[threadId] ?? [];
      const existingItems = state.runtimeItemsByIdByThread[threadId] ?? {};
      const item: RuntimeChatItem = {
        id: `err-${crypto.randomUUID()}`,
        type: "error",
        state: "completed",
        payload: { message: event.message },
        streams: {},
      };
      return {
        runtimeItemIdsByThread: {
          ...state.runtimeItemIdsByThread,
          [threadId]: [...existingIds, item.id],
        },
        runtimeItemsByIdByThread: {
          ...state.runtimeItemsByIdByThread,
          [threadId]: { ...existingItems, [item.id]: item },
        },
      };
    }

    default:
      return {};
  }
}

function coalesceRuntimeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  const coalesced: RuntimeEvent[] = [];
  let pendingDelta: Extract<RuntimeEvent, { type: "content.delta" }> | undefined;

  const flushPendingDelta = () => {
    if (!pendingDelta) return;
    coalesced.push(pendingDelta);
    pendingDelta = undefined;
  };

  for (const event of events) {
    if (event.type !== "content.delta") {
      flushPendingDelta();
      coalesced.push(event);
      continue;
    }
    if (
      pendingDelta &&
      pendingDelta.itemId === event.itemId &&
      pendingDelta.stream === event.stream
    ) {
      pendingDelta = {
        ...pendingDelta,
        delta: mergeStreamChunk(pendingDelta.delta, event.delta),
      };
      continue;
    }
    flushPendingDelta();
    pendingDelta = event;
  }

  flushPendingDelta();
  return coalesced;
}

/** Shallow-merge two payloads so item.updated layers on top of started. */
function mergePayload(prev: unknown, next: unknown): unknown {
  if (!prev || typeof prev !== "object") return next;
  if (!next || typeof next !== "object") return next;
  return { ...(prev as Record<string, unknown>), ...(next as Record<string, unknown>) };
}

/**
 * Some providers emit overlapping text chunks (next chunk starts with the tail
 * of the previous chunk) rather than strict append-only deltas. Merge the
 * largest shared suffix/prefix so streamed text stays stable.
 *
 * Append-only is by far the common case (Codex/Copilot ACP, OpenCode, Claude),
 * so the algorithm is biased to bail out cheaply when no overlap is possible:
 * we use `indexOf` to find candidate suffix-start positions in O(N) total
 * rather than iterating overlap sizes from `maxOverlap` down to 1 (each step
 * doing an O(K) `endsWith` check, which was O(N²) for long messages).
 */
function mergeStreamChunk(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;

  const maxOverlap = Math.min(existing.length, incoming.length);
  const firstChar = incoming[0]!;
  // Scan existing's tail (length up to maxOverlap) for positions where the
  // first character of `incoming` appears. The leftmost match yields the
  // largest possible overlap, so we accept the first one whose suffix matches
  // and short-circuit. When `firstChar` doesn't appear in the tail at all
  // (the typical append-only case), `indexOf` returns -1 and we skip the
  // body entirely — O(N) at worst, O(1) in the fast path.
  let candidate = existing.indexOf(firstChar, existing.length - maxOverlap);
  while (candidate !== -1) {
    const overlap = existing.length - candidate;
    if (existing.slice(candidate) === incoming.slice(0, overlap)) {
      return existing + incoming.slice(overlap);
    }
    candidate = existing.indexOf(firstChar, candidate + 1);
  }
  return existing + incoming;
}
