import { memo, useDeferredValue, useState } from "react";
import { Surface } from "@heroui/react";
import { Brain, ChevronDown } from "lucide-react";
import { PixelLoader } from "@/renderer/components/common";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { chatMessageSurfaceClass } from "./chatMessageSurface";
import { ItemMarkdown } from "./ItemMarkdown";

interface ReasoningProps {
  item: RuntimeChatItem;
}

export const Reasoning = memo(function Reasoning({ item }: ReasoningProps) {
  const rawText = item.streams.reasoning_text ?? "";
  const deferredText = useDeferredValue(rawText);
  const text = deferredText;
  const hasText = rawText.trim().length > 0;
  const isStreaming = item.state !== "completed";
  const [isOpen, setIsOpen] = useState(false);
  const actions = useChatPaneActions();

  // Once the turn moves past reasoning, keep the item collapsed-but-available
  // so the user can re-open it later. Drop only the empty case (some agents
  // emit a reasoning bracket without any text — nothing to expand).
  if (!isStreaming && !hasText) return null;

  if (!isStreaming) {
    // Compact toggle — visually distinct from tool-call accordions: no border
    // tile, dotted left rule when expanded, italic body. Equal vertical
    // padding so it doesn't visually bias toward the message above or below.
    return (
      <div className="flex w-full flex-col items-stretch justify-center px-3 py-2 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
        <button
          type="button"
          onClick={() => {
            setIsOpen((v) => !v);
            actions?.onContentHeightChange();
          }}
          aria-expanded={isOpen}
          className="inline-flex min-w-0 items-center gap-1.5 self-start leading-none italic opacity-80 hover:text-foreground hover:opacity-100"
        >
          <Brain className="size-3 shrink-0" />
          <span>Thought</span>
          <ChevronDown
            className={`size-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
        {isOpen ? (
          <div className="mt-2 max-h-64 overflow-y-auto border-l border-dashed border-[color:var(--border)] pl-3 italic [scrollbar-gutter:stable]">
            <ItemMarkdown text={text} mode="plain" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Surface variant="transparent" className={chatMessageSurfaceClass}>
      <div className="flex min-w-0 flex-col gap-1.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
        <div className="inline-flex items-center gap-1.5">
          <Brain className="size-3 shrink-0" />
          <span>Thinking</span>
          <PixelLoader size="xs" />
        </div>
        {hasText ? (
          <div className="max-h-64 overflow-y-auto pl-4 [scrollbar-gutter:stable]">
            <ItemMarkdown text={text} mode="plain" />
          </div>
        ) : null}
      </div>
    </Surface>
  );
});
