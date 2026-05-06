import type {
  CanonicalItemType,
  CanonicalRequestType,
  RequestPayload,
  RuntimeContentStreamKind,
  RuntimeEvent,
} from "@/shared/contracts";
import type { SliceCreator } from "./shared";

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
  applyRuntimeEvent(threadId: string, event: RuntimeEvent): void;
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

  applyRuntimeEvent: (threadId, event) =>
    set((state) => {
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
              event.payload !== undefined
                ? mergePayload(prev.payload, event.payload)
                : prev.payload,
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
      return { runtimeItemIdsByThread, runtimeItemsByIdByThread, runtimeRequestsByThread };
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
      };
    }),
});

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
 */
function mergeStreamChunk(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;

  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.endsWith(incoming.slice(0, overlap))) {
      return existing + incoming.slice(overlap);
    }
  }

  return existing + incoming;
}
