import { memo } from "react";
import { Surface } from "@heroui/react";
import { Layers } from "lucide-react";
import { PixelLoader } from "@/renderer/components/common";
import type { ToolCallPayload } from "@/shared/contracts";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { chatMessageSurfaceClass } from "./chatMessageSurface";

interface ContextCompactionProps {
  item: RuntimeChatItem;
}

export const ContextCompaction = memo(function ContextCompaction({ item }: ContextCompactionProps) {
  const isRunning = item.state !== "completed";

  if (isRunning) {
    return (
      <Surface variant="transparent" className={chatMessageSurfaceClass}>
        <div className="inline-flex min-w-0 items-center gap-1.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
          <Layers className="size-3 shrink-0" />
          <span>Compacting context</span>
          <PixelLoader size="xxs" />
        </div>
      </Surface>
    );
  }

  return (
    <div className="flex w-full flex-col items-stretch justify-center px-3 py-2 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
      <span className="inline-flex min-w-0 items-center gap-1.5 self-start leading-none italic opacity-80">
        <Layers className="size-3 shrink-0" />
        Context compacted
      </span>
    </div>
  );
});

/**
 * Names known to denote a context-compaction tool call. Compared
 * case-insensitively after stripping `_`, `-`, and whitespace, so codex's
 * `contextCompaction` and a hypothetical `context_compaction` /
 * `Context Compaction` from another agent all match.
 *
 * Add new providers here as their emission shape is discovered. Keep names
 * unambiguous — a bare `compaction` would risk false positives with unrelated
 * tools.
 */
const COMPACTION_NAME_KEYS: readonly string[] = [
  "contextcompaction",
  "compactcontext",
  "conversationcompaction",
  "compactconversation",
];

export function isContextCompactionToolCall(item: RuntimeChatItem): boolean {
  if (item.type !== "tool_call") return false;
  const name = (item.payload as ToolCallPayload | undefined)?.name;
  if (!name) return false;
  const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
  return COMPACTION_NAME_KEYS.includes(normalized);
}
