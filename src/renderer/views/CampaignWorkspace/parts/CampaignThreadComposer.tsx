import { useRef, useState, useEffect, type ClipboardEvent, type KeyboardEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, toast } from "@heroui/react";
import { FileSpreadsheet, Send } from "lucide-react";
import { submitConsultation } from "@/renderer/actions/consultationActions";
import { submitThreadInput } from "@/renderer/actions/threadRuntimeActions";
import { flattenSegments } from "@/renderer/components/composer/serializeMentions";
import type { PromptSegment } from "@/shared/contracts";
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
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { isMediaPlanFilename } from "./mediaPlanAttachment";

const submittingThreads = new Set<string>();

export interface CampaignThreadComposerProps {
  projectId: string;
  parentThreadId: string | undefined;
  campaignGroupId: string;
  defaultProvider: string;
  suggestedQuestions?: readonly string[];
  onAnalyzeMediaPlan?: (input: {
    filePath: string;
    filename: string;
    campaignGroupId: string;
  }) => void;
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
  const modelAliases = useSharedSettings((s) => s.modelAliases);

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
      const route = routeCampaignComposerMessage(input, props.defaultProvider, {
        modelAliases,
      });
      if (route.kind === "parse_error") {
        toast.warning(route.message);
        return;
      }
      if (route.kind === "empty" && attachments.attachments.length === 0) return;

      if (route.kind === "chat" || route.kind === "empty") {
        const attachmentSegments = attachments.toSegments();
        const textSegments: PromptSegment[] =
          route.kind === "chat" && route.message.trim()
            ? [{ kind: "text", content: route.message }]
            : [];
        const allSegments = [...attachmentSegments, ...textSegments];
        const flat = flattenSegments(allSegments);
        if (flat.length === 0) return;

        useAppStore.getState().requestChatScrollToBottom(threadId);
        await submitThreadInput(threadId, flat, allSegments.length > 0 ? allSegments : undefined);
        setInput("");
        attachments.clearAll();
        return;
      }

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
        route.message,
        copied.map((copy) => copy.relativePath),
      );

      const result = await submitConsultation({
        projectId: props.projectId,
        parentThreadId: threadId,
        campaignGroupId: props.campaignGroupId,
        message: messageWithAttachments,
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
      <div className="flex flex-col gap-2 border-t border-[var(--hairline)] bg-surface px-4 py-3">
        {props.suggestedQuestions && props.suggestedQuestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {props.suggestedQuestions.map((question) => (
              <button
                key={question}
                type="button"
                className="cockpit-chip max-w-full truncate"
                disabled={!props.parentThreadId || isSubmitting}
                onClick={() => setInput(question)}
              >
                {question}
              </button>
            ))}
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
          leading={
            props.onAnalyzeMediaPlan
              ? attachments.attachments
                  .filter((attachment) => isMediaPlanFilename(attachment.name))
                  .map((attachment) => (
                    <Button
                      key={`analyze-${attachment.id}`}
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[var(--cockpit-accent)]"
                      data-testid={`composer-analyze-${attachment.name}`}
                      onPress={() =>
                        props.onAnalyzeMediaPlan?.({
                          filePath: attachment.path,
                          filename: attachment.name,
                          campaignGroupId: props.campaignGroupId,
                        })
                      }
                    >
                      <FileSpreadsheet className="size-3.5" aria-hidden />
                      <Trans>Compare to published plan</Trans>
                    </Button>
                  ))
              : undefined
          }
        />
        <div className="flex items-end gap-2">
          <ComposerAddMenu mcpServers={[]} showFileOption onPickFiles={handlePickFiles} />
          <textarea
            ref={textareaRef}
            aria-label={t`Message composer`}
            placeholder={t`Ask ${props.defaultProvider} about this campaign — @mention for roles`}
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={!props.parentThreadId || isSubmitting}
            className="cockpit-askbar flex-1 resize-none rounded-xl border border-[var(--hairline-strong)] bg-surface-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted disabled:opacity-50"
          />
          <Button
            isIconOnly
            size="sm"
            variant="primary"
            className="bg-[var(--cockpit-accent)] text-[#0e0e14]"
            isDisabled={!canSubmit}
            aria-label={t`Send message`}
            onPress={() => void handleSubmit()}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
