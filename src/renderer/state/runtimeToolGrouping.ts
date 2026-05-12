import type { FileChangePayload, ToolCallPayload } from "@/shared/contracts";
import { extractLeadingPath } from "@/shared/extractLeadingPath";
import type { RuntimeChatItem } from "./slices/runtimeEventSlice";

const EDIT_TOOL_NAMES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Patch"]);

/**
 * Tool rows may be grouped together unless either side is an edit. Edits only
 * collapse with other edits that target the exact same normalized path.
 */
export function canShareRuntimeToolGroup(first: RuntimeChatItem, next: RuntimeChatItem): boolean {
  const firstEditTarget = getRuntimeToolEditTarget(first);
  const nextEditTarget = getRuntimeToolEditTarget(next);
  if (firstEditTarget !== undefined || nextEditTarget !== undefined) {
    return (
      firstEditTarget !== undefined &&
      nextEditTarget !== undefined &&
      firstEditTarget !== null &&
      firstEditTarget === nextEditTarget
    );
  }
  return true;
}

function getRuntimeToolEditTarget(item: RuntimeChatItem): string | null | undefined {
  if (item.type === "file_change") {
    const payload = item.payload as Partial<FileChangePayload> | undefined;
    return normalizeEditPath(payload?.path) ?? null;
  }
  if (item.type !== "tool_call") return undefined;

  const payload = item.payload as Partial<ToolCallPayload> | undefined;
  if (!payload || !isEditToolPayload(payload)) return undefined;
  return readEditToolPath(payload) ?? null;
}

function isEditToolPayload(payload: Partial<ToolCallPayload>): boolean {
  switch (payload.kind) {
    case "edit":
    case "delete":
    case "move":
      return true;
  }
  if (payload.name && EDIT_TOOL_NAMES.has(payload.name)) return true;
  if (isPersistedEditSummaryName(payload.name)) return true;
  const title = payload.title?.trim() || payload.name?.trim() || "";
  return isEditVerbTitle(title);
}

function readEditToolPath(payload: Partial<ToolCallPayload>): string | undefined {
  const locationPath = payload.locations?.find((location) => location.path.length > 0)?.path;
  const argsPath = readArgsPath(payload.args);
  const titlePath =
    extractPathFromEditTitle(payload.title) ?? extractPathFromEditTitle(payload.name);
  return normalizeEditPath(locationPath ?? argsPath ?? titlePath);
}

function readArgsPath(args: unknown): string | undefined {
  if (!args) return undefined;
  if (typeof args === "string") return extractPathFromPatchText(args);
  if (typeof args !== "object" || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ["file_path", "filePath", "notebook_path", "path"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function extractPathFromPatchText(text: string): string | undefined {
  const paths = [...text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map((match) => normalizeEditPath(match[1]?.trim()))
    .filter((path): path is string => path !== undefined);
  const uniquePaths = new Set(paths);
  return uniquePaths.size === 1 ? paths[0] : undefined;
}

function extractPathFromEditTitle(value: string | undefined): string | undefined {
  const leading = extractLeadingPath(value);
  if (leading) return leading;
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const match =
    /^(?:edit(?:ing)?|writ(?:e|ing)|patch(?:ing)?|creat(?:e|ing)|delet(?:e|ing)|remov(?:e|ing)|mov(?:e|ing))\s*:?\s+(.+)$/i.exec(
      trimmed,
    );
  return extractLeadingPath(match?.[1]);
}

function isEditVerbTitle(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return (
    normalized.startsWith("editing") ||
    normalized.startsWith("writing") ||
    normalized.startsWith("patching") ||
    normalized.startsWith("creating") ||
    normalized.startsWith("deleting") ||
    normalized.startsWith("removing")
  );
}

function isPersistedEditSummaryName(name: string | undefined): boolean {
  const parts = name
    ?.split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (!parts?.length) return false;
  return parts.some((part) => /^\d+\s+edits?$/i.test(part));
}

function normalizeEditPath(path: string | undefined): string | undefined {
  const normalized = path?.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  return normalized && normalized.length > 0 ? normalized : undefined;
}
