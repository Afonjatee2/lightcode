import { memo, useState } from "react";
import { Surface, Tooltip } from "@heroui/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { CanonicalContentBlock, MessageItemPayload } from "@/shared/contracts";
import { AttachmentBar, ImageLightbox, type Attachment } from "@/renderer/components/composer";
import { fileNameFromPath } from "@/shared/promptContent";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { chatMessageSurfaceClass } from "./chatMessageSurface";
import { ItemMarkdown } from "./ItemMarkdown";

interface UserMessageProps {
  item: RuntimeChatItem;
}

const COLLAPSED_LINE_COUNT = 4;
const COLLAPSED_CHAR_COUNT = 280;
const collapsedMessageClass =
  "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4]";

export const UserMessage = memo(function UserMessage({ item }: UserMessageProps) {
  const actions = useChatPaneActions();
  const [isExpanded, setIsExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const payload = getRuntimeItemPayload<MessageItemPayload>(item, "user_message");
  const content = payload?.content ?? [];
  const text = buildUserPromptText(content);
  const attachments = buildUserPromptAttachments(content);
  if (content.length === 0 || (text.length === 0 && attachments.length === 0)) return null;
  const isCollapsible = isLongUserMessage(text);
  const isCollapsed = isCollapsible && !isExpanded;
  const tooltipLabel = isExpanded ? "Show less" : "Show more";
  const Icon = isExpanded ? ChevronUp : ChevronDown;
  return (
    <Surface variant="tertiary" className={`${chatMessageSurfaceClass} relative`}>
      <div
        className={`min-w-0 space-y-1.5 leading-snug ${isCollapsed ? collapsedMessageClass : ""}`}
      >
        {text.length > 0 ? <ItemMarkdown text={text} /> : null}
        {attachments.length > 0 ? (
          <div className="-mx-2 -mt-1">
            <AttachmentBar
              attachments={attachments}
              onPreviewImage={(att) => {
                const idx = attachments.filter((a) => a.isImage).findIndex((a) => a.id === att.id);
                if (idx >= 0) setLightboxIndex(idx);
              }}
            />
          </div>
        ) : null}
      </div>
      {isCollapsible ? (
        <>
          {isCollapsed ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-3 bottom-2 h-6 rounded-b-3xl bg-gradient-to-t from-[var(--lc-surface-tertiary,var(--content-background))] to-transparent"
            />
          ) : null}
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-label={tooltipLabel}
                onClick={() => {
                  setIsExpanded((prev) => !prev);
                  actions?.onContentHeightChange();
                }}
                className="absolute bottom-1.5 right-2 flex size-5 items-center justify-center rounded-full bg-[var(--content-background)]/80 text-muted backdrop-blur-sm transition-colors hover:bg-[var(--content-background)] hover:text-foreground"
              >
                <Icon className="size-3" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content placement="top">{tooltipLabel}</Tooltip.Content>
          </Tooltip>
        </>
      ) : null}
      {lightboxIndex !== null ? (
        <ImageLightbox
          images={attachments.filter((a) => a.isImage)}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </Surface>
  );
});

function buildUserPromptText(content: CanonicalContentBlock[]): string {
  return content
    .map((block) => {
      if (block.kind === "text") return block.text;
      if (block.kind === "file" && block.source !== "attachment") return block.path;
      return "";
    })
    .join("");
}

function buildUserPromptAttachments(content: CanonicalContentBlock[]): Attachment[] {
  return content.flatMap((block, index): Attachment[] => {
    if (block.kind === "image" && block.source === "attachment" && block.path) {
      return [
        {
          id: `image-${index}-${block.path}`,
          path: block.path,
          name: block.name ?? fileNameFromPath(block.path),
          mimeType: block.mimeType,
          isImage: true,
        },
      ];
    }
    if (block.kind === "file" && block.source === "attachment") {
      return [
        {
          id: `attachment-${index}-${block.path}`,
          path: block.path,
          name: block.name ?? fileNameFromPath(block.path),
          isImage: false,
        },
      ];
    }
    return [];
  });
}

function isLongUserMessage(text: string): boolean {
  return (
    text.split(/\r\n|\r|\n/).length > COLLAPSED_LINE_COUNT || text.length > COLLAPSED_CHAR_COUNT
  );
}
