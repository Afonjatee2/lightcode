import { memo } from "react";
import { Surface } from "@heroui/react";
import type { MessageItemPayload } from "@/shared/contracts";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { chatMessageSurfaceClass } from "./chatMessageSurface";
import { ItemMarkdown } from "./ItemMarkdown";

interface UserMessageProps {
  item: RuntimeChatItem;
}

export const UserMessage = memo(function UserMessage({ item }: UserMessageProps) {
  const payload = getRuntimeItemPayload<MessageItemPayload>(item, "user_message");
  const text =
    payload?.content
      ?.map((b) => (b.kind === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n") ?? "";
  if (text.length === 0) return null;
  const mode = looksLikeMarkdown(text) ? "markdown" : "plain";
  return (
    <Surface variant="tertiary" className={chatMessageSurfaceClass}>
      <div className="min-w-0 leading-snug">
        <ItemMarkdown text={text} mode={mode} />
      </div>
    </Surface>
  );
});

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)#{1,6}\s|```|`[^`]+`|\[[^\]]+\]\([^)]*\)|(^|\n)\s*[-*+]\s|(^|\n)\s*\d+\.\s|\*\*[^*]+\*\*|__[^_]+__/.test(
    text,
  );
}
