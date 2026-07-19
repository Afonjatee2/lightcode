import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { net, protocol } from "electron";
import type { ProjectLocation } from "@/shared/contracts";
import type { PoracodePaths } from "@/shared/poracodePaths";
import { resolveLocalFileUrlPath } from "@/shared/promptContent";
import { getProjectFsPath } from "@/shared/wsl";

function sanitizeAttachmentPathPart(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "-");
}

function getThreadAttachmentDir(paths: PoracodePaths, threadId: string): string {
  const pathPart = sanitizeAttachmentPathPart(threadId).slice(0, 12);
  return join(paths.attachmentsDir, pathPart === "." || pathPart === ".." ? "--" : pathPart);
}

export function saveClipboardImageFile(
  paths: PoracodePaths,
  payload: { threadId: string; data: Uint8Array; extension: string },
): string {
  const threadDir = getThreadAttachmentDir(paths, payload.threadId);
  mkdirSync(threadDir, { recursive: true });
  const namePrefix = sanitizeAttachmentPathPart(payload.threadId).slice(0, 8);
  const fileName = `${namePrefix}-${Date.now()}.${payload.extension || "png"}`;
  const filePath = join(threadDir, fileName);
  writeFileSync(filePath, payload.data);
  return filePath;
}

/** Persist a browser-selected file under the paired desktop's attachment root. */
export function saveUploadedAttachmentFile(
  paths: PoracodePaths,
  payload: { threadId: string; data: Uint8Array; fileName: string },
): string {
  const threadDir = getThreadAttachmentDir(paths, payload.threadId);
  mkdirSync(threadDir, { recursive: true });
  const sanitizedName = Array.from(sanitizeAttachmentPathPart(payload.fileName))
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
  const originalName = sanitizedName || "attachment";
  const extension = extname(originalName);
  const stem = originalName.slice(0, originalName.length - extension.length) || "attachment";
  let filePath = join(threadDir, originalName);
  let suffix = 2;
  while (existsSync(filePath)) {
    filePath = join(threadDir, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }
  writeFileSync(filePath, payload.data);
  return filePath;
}

/** Write raw image bytes to a user-chosen absolute path (download "Save as…"). */
export function writeImageFile(filePath: string, data: Uint8Array): void {
  writeFileSync(filePath, Buffer.from(data));
}

export function saveHandoffContextFile(
  paths: PoracodePaths,
  payload: { threadId: string; content: string },
): string {
  const threadDir = getThreadAttachmentDir(paths, payload.threadId);
  mkdirSync(threadDir, { recursive: true });
  const filePath = join(threadDir, "handoff-context.md");
  writeFileSync(filePath, payload.content, "utf-8");
  return filePath;
}

export function deleteThreadAttachments(paths: PoracodePaths, threadId: string): void {
  rmSync(getThreadAttachmentDir(paths, threadId), { recursive: true, force: true });
}

export async function deleteThreadAttachmentsAsync(
  paths: PoracodePaths,
  threadId: string,
): Promise<void> {
  await rm(getThreadAttachmentDir(paths, threadId), { recursive: true, force: true });
}

export function resolveProjectFsPath(payload: {
  projectLocation: ProjectLocation;
  path?: string;
}): string {
  const rootPath = getProjectFsPath(payload.projectLocation);
  if (!payload.path) {
    return rootPath;
  }
  const resolved = normalize(join(rootPath, ...payload.path.split("/").filter(Boolean)));
  const normalizedRoot = normalize(rootPath);
  const sep = process.platform === "win32" ? "\\" : "/";
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  if (resolved !== normalizedRoot && !resolved.startsWith(rootPrefix)) {
    throw new Error("Path escapes the project root");
  }
  return resolved;
}

const LOCAL_FILE_PROTOCOL_SCHEMES = ["poracode-local", "lightcode-local"] as const;

export function registerLocalFileProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged(
    LOCAL_FILE_PROTOCOL_SCHEMES.map((scheme) => ({
      scheme,
      // `standard: true` is required so Chromium can load cached ACP registry
      // icons in CSS `mask-image` (ProviderIcon external glyphs). With
      // `standard: false` the scheme behaves like `file://` and mask sources
      // fail cross-origin from the renderer document.
      privileges: {
        standard: true,
        secure: true,
        corsEnabled: true,
        supportFetchAPI: true,
        stream: true,
      },
    })),
  );
}

export function installLocalFileProtocolHandler(): void {
  for (const scheme of LOCAL_FILE_PROTOCOL_SCHEMES) {
    protocol.handle(scheme, (request) => {
      const { pathToFileURL } = require("node:url") as typeof import("node:url");
      const filePath = resolveLocalFileUrlPath(request.url);
      if (filePath.includes("\0")) {
        return new Response("invalid path", { status: 400 });
      }
      const normalized = resolve(filePath);
      return net.fetch(pathToFileURL(normalized).href);
    });
  }
}
