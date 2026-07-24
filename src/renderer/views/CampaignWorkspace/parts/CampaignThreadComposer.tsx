import { useRef, useState, useEffect, type ClipboardEvent, type KeyboardEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, toast } from "@heroui/react";
import { Send } from "lucide-react";
import { submitConsultation } from "@/renderer/actions/consultationActions";
import { AttachmentBar } from "@/renderer/components/composer/AttachmentBar";
import { ComposerAddMenu } from "@/renderer/components/composer/ComposerAddMenu";
import { openAttachmentLightbox } from "@/renderer/components/composer/ImageLightbox";
import { openPdfPreview } from "@/renderer/components/pdf/openPdfPreview";
import { useAttachments } from "@/renderer/components/composer/useAttachments";
import { readBridge } from "@/renderer/bridge";
import { friendlyError } from "@/shared/messages";
import {
  buildCampaignMessageWithAttachments,
  copyCampaignComposerAttachments,
} from "./campaignComposerAttachments";
import {
  handleComposerAttachmentDragEnter,
  handleComposerAttachmentDragLeave,
  handleComposerAttachmentDragOver,
  handleComposerAttachmentDrop,
} from "./campaignComposerDrop";
import { routeCampaignComposerMessage } from "./campaignThreadComposerRouting";
import { useAppStore } from "@/renderer/state/appStore";

const submittingThreads = new Set<string>();

export interface CampaignThreadComposerProps {
  projectId: string;
  parentThreadId: string | undefined;
  campaignGroupId: string;
  defaultProvider: string;
}

export function CampaignThreadComposer(props: CampaignThreadComposerProps) {
  const { t } = useLingui();
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAttachmentDropActive, setIsAttachmentDropActive] = useState(false);
  const attachments = useAttachments();
  const attachmentDragDepthRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingPrefill = useAppStore((s) => s.pendingCampaignComposerPrefill);
  const setPendingCampaignComposerPrefill = useAppStore((s) => s.setPendingCampaignComposerPrefill);

  useEffect(() => {
    if (!pendingPrefill || pendingPrefill.projectId !== props.projectId) return;
    setInput(pendingPrefill.text);
    setPendingCampaignComposerPrefill(null);
    textareaRef.current?.focus();
  }, [pendingPrefill, props.projectId, setPendingCampaignComposerPrefill]);

  const hasContent = input.trim().length > 0 || attachments.attachments.length > 0;
  const canSubmit = Boolean(props.parentThreadId) && hasContent && !isSubmitting;

  async function handleSubmit() {
    const threadId = props.parentThreadId;
    if (!threadId || isSubmitting || !hasContent) return;
    if (submittingThreads.has(threadId)) return;

    submittingThreads.add(threadId);
    setIsSubmitting(true);
    try {
      const copied = await copyCampaignComposerAttachments({
        projectId: props.projectId,
        attachments: attachments.attachments,
      });
      for (const copy of copied) {
        if (copy.largeFile) {
          toast.warning(
            t`${copy.fileName} is larger than 100 MB. The agent may have trouble reading it.`,
          );
        }
      }

      const messageWithAttachments = buildCampaignMessageWithAttachments(
        input,
        copied.map((copy) => copy.relativePath),
      );
      const route = routeCampaignComposerMessage(messageWithAttachments, props.defaultProvider);
      if (route.kind === "empty") return;
      if (route.kind === "parse_error") {
        toast.warning(route.message);
        return;
      }

      const result = await submitConsultation({
        projectId: props.projectId,
        parentThreadId: threadId,
        campaignGroupId: props.campaignGroupId,
        message: route.message,
      });
      if (!result.ok) {
        toast.warning(result.message);
        return;
      }
      setInput("");
      attachments.clearAll();
    } catch (error: unknown) {
      toast.warning(friendlyError(error));
    } finally {
      submittingThreads.delete(threadId);
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && canSubmit) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files).find((item) =>
      item.type.startsWith("image/"),
    );
    if (!file || !props.parentThreadId) return;
    event.preventDefault();
    void attachments
      .addClipboardImage(file, `campaign:${props.projectId}`)
      .catch((error: unknown) => toast.warning(friendlyError(error)));
  }

  function handlePickFiles() {
    void readBridge()
      .pickFiles({ attachmentThreadId: `campaign:${props.projectId}` })
      .then((paths) => {
        if (paths) attachments.addFiles(paths);
      })
      .catch((error: unknown) => toast.warning(friendlyError(error)));
  }

  const onAttachFiles = props.parentThreadId ? attachments.addFiles : undefined;

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-divider"
      onDragEnter={(event) =>
        handleComposerAttachmentDragEnter(
          event,
          onAttachFiles,
          attachmentDragDepthRef,
          setIsAttachmentDropActive,
        )
      }
      onDragOver={(event) => handleComposerAttachmentDragOver(event, onAttachFiles)}
      onDragLeave={(event) =>
        handleComposerAttachmentDragLeave(
          event,
          onAttachFiles,
          attachmentDragDepthRef,
          setIsAttachmentDropActive,
        )
      }
      onDrop={(event) =>
        handleComposerAttachmentDrop(
          event,
          onAttachFiles,
          attachmentDragDepthRef,
          setIsAttachmentDropActive,
        )
      }
    >
      {isAttachmentDropActive ? (
        <div className="poracode-composer-drop-overlay">
          <Trans>Drop here to attach</Trans>
        </div>
      ) : null}
      <AttachmentBar
        attachments={attachments.attachments}
        onRemove={attachments.removeAttachment}
        onPreviewImage={(att) => {
          const imageAttachments = attachments.attachments.filter(
            (attachment) => attachment.isImage,
          );
          const index = imageAttachments.findIndex((attachment) => attachment.id === att.id);
          if (index >= 0) openAttachmentLightbox(imageAttachments, index);
        }}
        onPreviewPdf={(att) => openPdfPreview(att.path)}
        layout="flush"
      />
      <div className="flex items-end gap-2 p-3">
        <ComposerAddMenu mcpServers={[]} showFileOption onPickFiles={handlePickFiles} />
        <textarea
          ref={textareaRef}
          aria-label={t`Message composer`}
          placeholder={t`@codex check budget pacing, or type a message…`}
          rows={2}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={!props.parentThreadId || isSubmitting}
          className="flex-1 resize-none rounded-medium border border-divider bg-content1 px-3 py-2 text-small text-foreground placeholder:text-default-400 disabled:opacity-50"
        />
        <Button
          isIconOnly
          size="sm"
          variant="primary"
          isDisabled={!canSubmit}
          aria-label={t`Send message`}
          onPress={() => void handleSubmit()}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
