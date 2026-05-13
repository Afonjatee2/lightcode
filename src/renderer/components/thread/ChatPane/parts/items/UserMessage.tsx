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
import { normalizeChatProjectPath } from "../../chatPathUtils";
import { chatMessageSurfaceClass } from "./chatMessageSurface";
import { InlineFilePathChip } from "./InlineFilePathChip";
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
  const hasVisualOverflowRef = useRef(false);
  const payload = getRuntimeItemPayload<MessageItemPayload>(item, "user_message");
  const content = payload?.content ?? [];
  const rawText = buildUserPromptText(content);
  const { slashCommand, body } = extractLeadingSlashCommand(rawText);
  const text = body;
  const slashCommandPrefixLength = slashCommand ? rawText.length - body.length : 0;
  const hasInlineFileMentions = content.some(
    (block) => block.kind === "file" && block.source !== "attachment",
  );
  const attachments = buildUserPromptAttachments(content);

  const syncVisualOverflow = useEffectEvent(() => {
    const element = contentRef.current;
    if (!element) return;
    const nextHasVisualOverflow = measureUserMessageOverflow(element);
    if (hasVisualOverflowRef.current !== nextHasVisualOverflow) {
      hasVisualOverflowRef.current = nextHasVisualOverflow;
      setHasVisualOverflow(nextHasVisualOverflow);
      actions?.onContentHeightChange();
    }
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

  if (content.length === 0 || (text.length === 0 && attachments.length === 0 && !slashCommand))
    return null;
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
        {slashCommand ? (
          <div className="lightcode-user-message-inline-content whitespace-pre-wrap break-words text-[length:var(--lc-chat-font-size)] leading-snug text-foreground">
            <span className="lightcode-slash-chip lightcode-slash-chip--user-message mr-1.5">
              <span className="lightcode-slash-chip__slash">/</span>
              <span className="lightcode-slash-chip__name">{slashCommand}</span>
            </span>
            {renderUserMessageInlineContent(content, slashCommandPrefixLength, actions)}
          </div>
        ) : hasInlineFileMentions ? (
          <div className="lightcode-user-message-inline-content whitespace-pre-wrap break-words text-[length:var(--lc-chat-font-size)] leading-snug text-foreground">
            {renderUserMessageInlineContent(content, 0, actions)}
          </div>
        ) : text.length > 0 ? (
          <ItemMarkdown text={text} />
        ) : null}
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

const LEADING_SLASH_COMMAND_RE = /^\/([A-Za-z][A-Za-z0-9_-]*)(\s+|$)/;

function extractLeadingSlashCommand(text: string): { slashCommand: string | null; body: string } {
  const match = text.match(LEADING_SLASH_COMMAND_RE);
  if (!match) return { slashCommand: null, body: text };
  return { slashCommand: match[1]!, body: text.slice(match[0].length) };
}

function buildUserPromptText(content: CanonicalContentBlock[]): string {
  return content
    .map((block) => {
      if (block.kind === "text") return block.text;
      if (block.kind === "file" && block.source !== "attachment") return block.path;
      return "";
    })
    .join("");
}

function renderUserMessageInlineContent(
  content: CanonicalContentBlock[],
  skipLeadingTextLength: number,
  actions: ReturnType<typeof useChatPaneActions>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remainingSkip = skipLeadingTextLength;

  content.forEach((block, index) => {
    if (block.kind === "text") {
      if (remainingSkip >= block.text.length) {
        remainingSkip -= block.text.length;
        return;
      }
      const text = remainingSkip > 0 ? block.text.slice(remainingSkip) : block.text;
      remainingSkip = 0;
      if (text.length > 0) nodes.push(<span key={`text-${index}`}>{text}</span>);
      return;
    }

    if (block.kind === "file") {
      if (block.source === "attachment") return;
      if (remainingSkip >= block.path.length) {
        remainingSkip -= block.path.length;
        return;
      }
      remainingSkip = 0;
      const path = actions?.projectLocation
        ? normalizeChatProjectPath(block.path, actions.projectLocation)
        : block.path;
      nodes.push(
        <InlineFilePathChip
          key={`file-${index}-${block.path}`}
          path={path}
          onOpen={actions?.openProjectRelativePath}
        />,
      );
    }
  });

  return nodes;
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
