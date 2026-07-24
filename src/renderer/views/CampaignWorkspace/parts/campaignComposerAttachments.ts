import { msg } from "@lingui/core/macro";
import { readBridge } from "@/renderer/bridge";
import { i18n } from "@/renderer/i18n/i18n";
import type { Attachment } from "@/renderer/components/composer/useAttachments";
import type { CopiedCampaignConsultationAttachment } from "@/shared/ipc/schemas";

export function buildCampaignMessageWithAttachments(
  message: string,
  relativePaths: readonly string[],
): string {
  if (relativePaths.length === 0) return message;
  const attachmentLine = i18n._(msg`Attached files: ${relativePaths.join(" ")}`);
  const trimmed = message.trim();
  return trimmed ? `${trimmed}\n\n${attachmentLine}` : attachmentLine;
}

export async function copyCampaignComposerAttachments(input: {
  projectId: string;
  attachments: readonly Attachment[];
}): Promise<CopiedCampaignConsultationAttachment[]> {
  if (input.attachments.length === 0) return [];
  const { copies } = await readBridge().copyCampaignConsultationAttachments({
    projectId: input.projectId,
    sourcePaths: input.attachments.map((attachment) => attachment.path),
  });
  return copies;
}
