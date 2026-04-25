import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { net, protocol } from "electron";
import type { ProjectLocation } from "@/shared/contracts";
import type { LightcodePaths } from "@/shared/lightcodePaths";
import { getProjectFsPath } from "@/shared/wsl";

function getThreadAttachmentDir(paths: LightcodePaths, threadId: string): string {
  return join(paths.attachmentsDir, threadId.replace(/:/g, "-").slice(0, 12));
}

export function saveClipboardImageFile(
  paths: LightcodePaths,
  payload: { threadId: string; data: Uint8Array; extension: string },
): string {
  const threadDir = getThreadAttachmentDir(paths, payload.threadId);
  mkdirSync(threadDir, { recursive: true });
  const fileName = `${payload.threadId.slice(0, 8)}-${Date.now()}.${payload.extension || "png"}`;
  const filePath = join(threadDir, fileName);
  writeFileSync(filePath, Buffer.from(payload.data));
  return filePath;
}

export function saveHandoffContextFile(
  paths: LightcodePaths,
  payload: { threadId: string; content: string },
): string {
  const threadDir = getThreadAttachmentDir(paths, payload.threadId);
  mkdirSync(threadDir, { recursive: true });
  const filePath = join(threadDir, "handoff-context.md");
  writeFileSync(filePath, payload.content, "utf-8");
  return filePath;
}

export function deleteThreadAttachments(paths: LightcodePaths, threadId: string): void {
  rmSync(getThreadAttachmentDir(paths, threadId), { recursive: true, force: true });
}

export function resolveProjectFsPath(payload: {
  projectLocation: ProjectLocation;
  path?: string;
}): string {
  const rootPath = getProjectFsPath(payload.projectLocation);
  if (!payload.path) {
    return rootPath;
  }
  return join(rootPath, ...payload.path.split("/").filter(Boolean));
}

export function registerLocalFileProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "lightcode-local",
      privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function installLocalFileProtocolHandler(): void {
  protocol.handle("lightcode-local", (request) => {
    const raw = decodeURIComponent(new URL(request.url).pathname);
    const { pathToFileURL } = require("node:url") as typeof import("node:url");
    const filePath = process.platform === "win32" && /^\/[A-Za-z]:/.test(raw) ? raw.slice(1) : raw;
    return net.fetch(pathToFileURL(filePath).href);
  });
}
