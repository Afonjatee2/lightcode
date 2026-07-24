import { existsSync } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type {
  CopiedCampaignConsultationAttachment,
  CopyCampaignConsultationAttachmentsPayload,
  CopyCampaignConsultationAttachmentsResult,
} from "@/shared/ipc/schemas";
import { ensureCampaignWorkspaceDir } from "./campaignWorkspaceDir";

export const CAMPAIGN_ATTACHMENT_SUBDIR = "attachments";
export const CAMPAIGN_LARGE_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export type {
  CopiedCampaignConsultationAttachment,
  CopyCampaignConsultationAttachmentsPayload,
  CopyCampaignConsultationAttachmentsResult,
};

function resolveCollisionSafePath(dir: string, fileName: string): string {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length) || "attachment";
  let candidate = join(dir, fileName);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }
  return candidate;
}

/**
 * Copies composer attachments into the managed campaign workspace so agents can
 * read them from their cwd. Returns workspace-relative paths (never absolute).
 */
export async function copyCampaignConsultationAttachments(
  baseDir: string,
  payload: CopyCampaignConsultationAttachmentsPayload,
): Promise<CopyCampaignConsultationAttachmentsResult> {
  const { path: workspacePath } = ensureCampaignWorkspaceDir(baseDir, {
    projectId: payload.projectId,
    ...(payload.name !== undefined ? { name: payload.name } : {}),
  });
  const attachmentsDir = join(workspacePath, CAMPAIGN_ATTACHMENT_SUBDIR);
  await mkdir(attachmentsDir, { recursive: true });

  const copies: CopiedCampaignConsultationAttachment[] = [];
  for (const sourcePath of payload.sourcePaths) {
    const originalName = basename(sourcePath);
    const destPath = resolveCollisionSafePath(attachmentsDir, originalName);
    await copyFile(sourcePath, destPath);
    const sizeBytes = (await stat(destPath)).size;
    copies.push({
      relativePath: `./${CAMPAIGN_ATTACHMENT_SUBDIR}/${basename(destPath)}`,
      fileName: basename(destPath),
      sizeBytes,
      largeFile: sizeBytes > CAMPAIGN_LARGE_ATTACHMENT_BYTES,
    });
  }
  return { copies };
}
