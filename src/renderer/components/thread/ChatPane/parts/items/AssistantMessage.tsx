import { memo, useDeferredValue } from "react";
import { Surface } from "@heroui/react";
import type { MessageItemPayload } from "@/shared/contracts";
import { PixelLoader } from "@/renderer/components/common";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { chatMessageSurfaceClass } from "./chatMessageSurface";
import { ItemMarkdown } from "./ItemMarkdown";

interface AssistantMessageProps {
  item: RuntimeChatItem;
}

export const AssistantMessage = memo(function AssistantMessage({ item }: AssistantMessageProps) {
  const stream = item.streams.assistant_text ?? "";
  const payload = getRuntimeItemPayload<MessageItemPayload>(item, "assistant_message");
  const rawText =
    stream.length > 0
      ? stream
      : (payload?.content
          ?.map((b) => (b.kind === "text" ? b.text : ""))
          .filter(Boolean)
          .join("\n") ?? "");
  const deferredText = useDeferredValue(rawText);
  const text = item.state === "completed" ? rawText : deferredText;
  const isStreaming = item.state !== "completed";
  return (
    <Surface variant="transparent" className={chatMessageSurfaceClass}>
      <div className="min-w-0 leading-snug">
        {rawText.length > 0 ? <ItemMarkdown text={text} /> : null}
        {isStreaming && rawText.length === 0 ? (
          <div className="text-foreground-muted">
            <PixelLoader size="xxs" />
          </div>
        ) : null}
      </div>
    </Surface>
  );
});
