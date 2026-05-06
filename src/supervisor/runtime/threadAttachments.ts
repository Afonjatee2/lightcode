import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { PromptSegment, ProjectLocation } from "@/shared/contracts";
import { getWslCommand, resolveWslHomeDirectory } from "../agents/base";
import { spawnSync } from "node:child_process";

const wslAttachmentDirCache = new Map<string, { uncDir: string; linuxDir: string }>();

function resolveWslAttachmentDirs(distro: string): { uncDir: string; linuxDir: string } {
  const cached = wslAttachmentDirCache.get(distro);
  if (cached) {
    return cached;
  }

  const homeDir = resolveWslHomeDirectory(distro);
  const linuxDir = homeDir ? `${homeDir}/.lightcode/attachments` : undefined;
  if (!linuxDir) {
    throw new Error(`Unable to resolve home for WSL distro "${distro}"`);
  }

  spawnSync(getWslCommand(), ["-d", distro, "--", "mkdir", "-p", linuxDir], { timeout: 5000 });
  const uncDir = `\\\\wsl.localhost\\${distro}${linuxDir.replace(/\//g, "\\")}`;
  const entry = { uncDir, linuxDir };
  wslAttachmentDirCache.set(distro, entry);
  return entry;
}

function isImageAttachmentSegment(segment: PromptSegment): boolean {
  if (segment.kind !== "attachment") {
    return false;
  }
  return (
    segment.mimeType?.startsWith("image/") === true ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(segment.path)
  );
}

export function rewriteSegmentsForWsl(
  segments: PromptSegment[],
  location: ProjectLocation,
  options?: { preserveImageAttachments?: boolean },
): PromptSegment[] {
  if (location.kind !== "wsl") {
    return segments;
  }

  let dirs: { uncDir: string; linuxDir: string } | undefined;
  return segments.map((segment) => {
    if ((segment.kind !== "attachment" && segment.kind !== "file") || !segment.path) {
      return segment;
    }
    if (options?.preserveImageAttachments && isImageAttachmentSegment(segment)) {
      return segment;
    }
    if (!/^[A-Za-z]:[\\/]/.test(segment.path)) {
      return segment;
    }

    dirs ??= resolveWslAttachmentDirs(location.distro);
    mkdirSync(dirs.uncDir, { recursive: true });

    const fileName = basename(segment.path);
    const destination = join(dirs.uncDir, fileName);
    try {
      copyFileSync(segment.path, destination);
    } catch (error) {
      console.warn(`[wsl-attach] failed to copy ${segment.path} -> ${destination}:`, error);
      return segment;
    }
    return { ...segment, path: `${dirs.linuxDir}/${fileName}` };
  });
}
