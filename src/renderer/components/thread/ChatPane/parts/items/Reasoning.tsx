import { memo, useDeferredValue, useState } from "react";
import { Surface } from "@heroui/react";
import { Brain, ChevronDown } from "lucide-react";
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
            <ItemMarkdown text={text} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Surface variant="transparent" className={chatMessageSurfaceClass}>
      <div className="flex min-w-0 flex-col gap-1.5 text-[length:var(--lc-chat-font-size-meta)] text-foreground-muted">
        <div className="inline-flex items-center gap-1.5">
          <Brain className="lightcode-brain-thinking size-3 shrink-0" aria-label="Thinking" />
          <span className="lightcode-thinking-text">Thinking</span>
        </div>
        {hasText ? (
          <div className="max-h-64 overflow-y-auto pl-4 [scrollbar-gutter:stable]">
            <ItemMarkdown text={text} />
          </div>
        ) : null}
      </div>
    </Surface>
  );
});
