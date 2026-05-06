import { useMemo } from "react";
import { Disclosure } from "@heroui/react";
import { useAppStore } from "@/renderer/state/appStore";
import type {
  OpenRuntimeRequest,
  RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";

interface ChatRuntimeDebugPanelProps {
  threadId: string;
}

function shortenId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatJsonBlock(value: unknown): string {
  if (value === undefined) return "// undefined";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function RuntimeItemDebug(props: { index: number; item: RuntimeChatItem }) {
  const { index, item } = props;
  const streamEntries = Object.entries(item.streams);
  const heading = `#${index + 1} ${item.type} · ${item.state} · ${shortenId(item.id)}`;

  return (
    <Disclosure className="rounded-lg border border-[color:var(--border)] bg-[var(--composer-surface)] text-[length:var(--lc-chat-font-size-meta)]">
      <Disclosure.Heading className="px-2 py-1">
        <Disclosure.Trigger className="flex w-full min-w-0 items-center gap-2 text-left">
          <code className="min-w-0 flex-1 truncate font-mono text-foreground">{heading}</code>
          <Disclosure.Indicator className="shrink-0 text-[color:var(--muted)]" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="space-y-3 border-t border-[color:var(--border)] px-2 py-2">
          <div>
            <p className="mb-1 text-[0.85em] font-medium uppercase tracking-wide text-[color:var(--muted)]">
              id
            </p>
            <pre className="max-h-24 overflow-auto rounded-md bg-foreground/5 p-2 font-mono leading-snug whitespace-pre-wrap break-all text-foreground">
              {item.id}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[0.85em] font-medium uppercase tracking-wide text-[color:var(--muted)]">
              payload
            </p>
            <pre className="max-h-[min(12rem,30vh)] overflow-auto rounded-md bg-foreground/5 p-2 font-mono leading-snug whitespace-pre-wrap break-words text-foreground">
              {formatJsonBlock(item.payload)}
            </pre>
          </div>
          {streamEntries.length === 0 ? (
            <p className="text-[color:var(--muted)]">No content streams.</p>
          ) : (
            streamEntries.map(([key, text]) => (
              <div key={key}>
                <p className="mb-1 text-[0.85em] font-medium uppercase tracking-wide text-[color:var(--muted)]">
                  stream · {key}
                </p>
                <pre className="max-h-[min(16rem,40vh)] overflow-auto rounded-md bg-foreground/5 p-2 font-mono leading-snug whitespace-pre-wrap break-words text-foreground">
                  {text ?? ""}
                </pre>
              </div>
            ))
          )}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

function OpenRequestDebug(props: { index: number; request: OpenRuntimeRequest }) {
  const { index, request } = props;
  const heading = `Request · ${request.requestType} · ${shortenId(request.requestId)}`;

  return (
    <Disclosure className="rounded-lg border border-dashed border-[color:var(--border)] bg-[var(--composer-surface)] text-[length:var(--lc-chat-font-size-meta)]">
      <Disclosure.Heading className="px-2 py-1">
        <Disclosure.Trigger className="flex w-full min-w-0 items-center gap-2 text-left">
          <code className="min-w-0 flex-1 truncate font-mono text-foreground">{heading}</code>
          <Disclosure.Indicator className="shrink-0 text-[color:var(--muted)]" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="space-y-2 border-t border-[color:var(--border)] px-2 py-2">
          <p className="text-[0.85em] text-[color:var(--muted)]">
            Opened {request.receivedAt} (#{index + 1})
          </p>
          <pre className="max-h-[min(12rem,30vh)] overflow-auto rounded-md bg-foreground/5 p-2 font-mono leading-snug whitespace-pre-wrap break-words text-foreground">
            {formatJsonBlock(request.payload)}
          </pre>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

/** Inspector for canonical runtime chat items (payload + streams) for one thread. */
export function ChatRuntimeDebugPanel({ threadId }: ChatRuntimeDebugPanelProps) {
  const itemIds = useAppStore((s) => s.runtimeItemIdsByThread[threadId] ?? EMPTY_IDS);
  const itemsById = useAppStore((s) => s.runtimeItemsByIdByThread[threadId] ?? EMPTY_ITEMS_BY_ID);
  const requests = useAppStore((s) => s.runtimeRequestsByThread[threadId] ?? EMPTY_REQ);
  const items = useMemo(
    () =>
      itemIds.map((itemId) => itemsById[itemId]).filter((item): item is RuntimeChatItem => !!item),
    [itemIds, itemsById],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-[length:var(--lc-chat-font-size-meta)]">
      <div className="shrink-0 border-b border-[color:var(--border)] pb-2">
        <p className="font-semibold text-foreground">Runtime debug</p>
        <p className="mt-0.5 text-[0.85em] leading-snug text-[color:var(--muted)]">
          Canonical items from <code className="font-mono">runtimeEventSlice</code> — same data as
          the chat UI, raw structure.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-gutter:stable] pr-1">
        {items.length === 0 && requests.length === 0 ? (
          <p className="text-[color:var(--muted)]">No runtime items yet for this thread.</p>
        ) : null}
        {items.map((item, i) => (
          <RuntimeItemDebug key={item.id} index={i} item={item} />
        ))}
        {requests.length > 0 ? (
          <p className="pt-2 text-[0.85em] font-medium uppercase tracking-wide text-[color:var(--muted)]">
            Open requests
          </p>
        ) : null}
        {requests.map((req, i) => (
          <OpenRequestDebug key={req.requestId} index={i} request={req} />
        ))}
      </div>
    </div>
  );
}

const EMPTY_IDS = Object.freeze([]) as ReadonlyArray<string>;
const EMPTY_ITEMS_BY_ID = Object.freeze({}) as Readonly<Record<string, RuntimeChatItem>>;
const EMPTY_REQ = Object.freeze([]) as ReadonlyArray<OpenRuntimeRequest>;
