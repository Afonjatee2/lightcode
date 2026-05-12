import { memo, type ReactNode, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
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
  checkpointRevertControl: ReactNode | null;
}

const COLLAPSED_LINE_COUNT = 4;
const FALLBACK_LINE_HEIGHT_RATIO = 1.375;
const OVERFLOW_EPSILON_PX = 2;
const collapsedMessageClass =
  "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] [mask-image:linear-gradient(to_bottom,black_65%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_65%,transparent)]";

export const UserMessage = memo(function UserMessage({
  item,
  checkpointRevertControl,
}: UserMessageProps) {
  const actions = useChatPaneActions();
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasVisualOverflow, setHasVisualOverflow] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const payload = getRuntimeItemPayload<MessageItemPayload>(item, "user_message");
  const content = payload?.content ?? [];
  const text = buildUserPromptText(content);
  const attachments = buildUserPromptAttachments(content);

  const syncVisualOverflow = useEffectEvent(() => {
    const element = contentRef.current;
    if (!element) return;
    const nextHasVisualOverflow = measureUserMessageOverflow(element);
    setHasVisualOverflow((prev) => {
      if (prev === nextHasVisualOverflow) return prev;
      actions?.onContentHeightChange();
      return nextHasVisualOverflow;
    });
    if (!nextHasVisualOverflow) setIsExpanded(false);
  });

  useLayoutEffect(() => {
    syncVisualOverflow();
  }, [text, attachments.length]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      syncVisualOverflow();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (content.length === 0 || (text.length === 0 && attachments.length === 0)) return null;
  const isCollapsible = hasVisualOverflow;
  const isCollapsed = isCollapsible && !isExpanded;
  const tooltipLabel = isExpanded ? "Show less" : "Show more";
  const Icon = isExpanded ? ChevronUp : ChevronDown;
  return (
    <Surface variant="tertiary" className={`${chatMessageSurfaceClass} relative`}>
      <div
        ref={contentRef}
        data-user-message-content="true"
        className={`min-w-0 space-y-1.5 leading-snug ${checkpointRevertControl ? "pr-7" : ""} ${
          isCollapsed ? collapsedMessageClass : isCollapsible ? "max-h-[50vh] overflow-y-auto" : ""
        }`}
      >
        {attachments.length > 0 ? (
          <div className="-mt-1">
            <AttachmentBar
              attachments={attachments}
              layout="flush"
              hideImageNames
              onPreviewImage={(att) => {
                const idx = attachments.filter((a) => a.isImage).findIndex((a) => a.id === att.id);
                if (idx >= 0) setLightboxIndex(idx);
              }}
            />
          </div>
        ) : null}
        {text.length > 0 ? <ItemMarkdown text={text} /> : null}
      </div>
      {isCollapsible ? (
        <>
          <Tooltip delay={300}>
            <Tooltip.Trigger
              aria-expanded={isExpanded}
              aria-label={tooltipLabel}
              onClick={() => {
                setIsExpanded((prev) => !prev);
                actions?.onContentHeightChange();
              }}
              className="absolute bottom-1 right-2 flex size-5 items-center justify-center text-muted transition-colors hover:text-foreground"
            >
              <Icon className="size-3.5" />
            </Tooltip.Trigger>
            <Tooltip.Content placement="top">{tooltipLabel}</Tooltip.Content>
          </Tooltip>
        </>
      ) : null}
      {checkpointRevertControl}
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

function measureUserMessageOverflow(element: HTMLElement): boolean {
  const fullHeight = Math.max(element.scrollHeight, element.getBoundingClientRect().height);
  return fullHeight - getCollapsedHeight(element) > OVERFLOW_EPSILON_PX;
}

function getCollapsedHeight(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const fontSize = parseCssPx(style.fontSize) ?? 16;
  const lineHeight = parseCssLineHeight(style.lineHeight, fontSize);
  return lineHeight * COLLAPSED_LINE_COUNT;
}

function parseCssLineHeight(value: string, fontSize: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fontSize * FALLBACK_LINE_HEIGHT_RATIO;
  if (value.trim().endsWith("px")) return parsed;
  if (parsed <= 4) return parsed * fontSize;
  return parsed;
}

function parseCssPx(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
