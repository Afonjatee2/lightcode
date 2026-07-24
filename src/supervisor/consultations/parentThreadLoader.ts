import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { dbGetThreadRuntimeItems } from "@/main/db/runtimeItems";
import type { PersistedRuntimeItem } from "@/main/db/runtimeItems";
import { resolvePoracodePaths } from "@/shared/poracodePaths";
import type { ConversationTurn, PermittedAttachment } from "@/shared/consultations";
import type { ParentThreadLoader } from "./supervisorAdapters";

/**
 * Production {@link ParentThreadLoader} (Part 3). Reads the REAL parent thread
 * from Poracode's durable runtime-item store and the on-disk attachment folder —
 * replacing the earlier `async () => []` stub. Only user/assistant conversation
 * turns are returned (hidden reasoning / chain-of-thought, plan/goal/error and
 * tool-call items are excluded), in chronological order, with stable message ids
 * for summary reuse. Attachments are filtered to omit credentials and private
 * configuration before any content is excerpted.
 */

const ATTACHMENT_EXCERPT_CHARS = 4_000;

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".tsv",
  ".log",
  ".yml",
  ".yaml",
  ".xml",
  ".html",
]);

/** Extensions that must never be read into a context packet. */
const SECRET_EXTENSIONS = new Set([
  ".env",
  ".pem",
  ".key",
  ".crt",
  ".cer",
  ".der",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
  ".secret",
  ".npmrc",
  ".netrc",
  ".asc",
  ".gpg",
]);

/** Filename fragments that indicate credentials / private configuration. */
const SECRET_NAME_FRAGMENTS = [
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credential",
  "secret",
  "token",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "private_key",
  "ssh_key",
  ".env",
  "known_hosts",
  "authorized_keys",
];

function isPermittedAttachmentFile(fileName: string): boolean {
  if (fileName.startsWith(".")) return false;
  const lower = fileName.toLowerCase();
  const extension = extname(lower);
  if (SECRET_EXTENSIONS.has(extension)) return false;
  return !SECRET_NAME_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/** Concatenate the `text` content blocks of a message payload. */
function blocksToText(payload: unknown): string {
  const blocks = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { content?: unknown }).content)
      ? (payload as { content: unknown[] }).content
      : null;
  if (!blocks) return "";
  let text = "";
  for (const block of blocks) {
    if (block && typeof block === "object" && (block as { kind?: unknown }).kind === "text") {
      const value = (block as { text?: unknown }).text;
      if (typeof value === "string") text += value;
    }
  }
  return text;
}

/**
 * Map a persisted runtime item to a conversation turn. Returns null for hidden
 * reasoning / chain-of-thought, internal UI items, tool calls and sub-agent
 * children — the context packet must only carry the user-visible conversation.
 */
function toConversationTurn(item: PersistedRuntimeItem): ConversationTurn | null {
  if (item.parentItemId) return null;
  switch (item.type) {
    case "user_message": {
      const content = blocksToText(item.payload);
      if (content.trim().length === 0) return null;
      return { role: "user", content, messageId: item.id, createdAt: null };
    }
    case "assistant_message": {
      const content = item.streams.assistant_text ?? blocksToText(item.payload);
      if (content.trim().length === 0) return null;
      return { role: "assistant", content, messageId: item.id, createdAt: null };
    }
    default:
      return null;
  }
}

export function loadParentThreadMessages(threadId: string, limit: number): ConversationTurn[] {
  const items = dbGetThreadRuntimeItems(threadId);
  const turns: ConversationTurn[] = [];
  for (const item of items) {
    const turn = toConversationTurn(item);
    if (turn) turns.push(turn);
  }
  return limit > 0 ? turns.slice(-limit) : turns;
}

function sanitizeAttachmentPathPart(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "-");
}

function threadAttachmentDir(threadId: string, baseDir: string): string {
  const paths = resolvePoracodePaths(baseDir);
  const pathPart = sanitizeAttachmentPathPart(threadId).slice(0, 12);
  const safePart = pathPart === "." || pathPart === ".." ? "--" : pathPart;
  return join(paths.attachmentsDir, safePart);
}

function loadParentThreadAttachments(threadId: string, baseDir: string): PermittedAttachment[] {
  let directory: string;
  try {
    directory = threadAttachmentDir(threadId, baseDir);
    if (!statSync(directory).isDirectory()) return [];
  } catch {
    return [];
  }
  const attachments: PermittedAttachment[] = [];
  for (const name of readdirSync(directory)) {
    if (!isPermittedAttachmentFile(name)) continue;
    const fullPath = join(directory, name);
    // Prevent symlink escapes — resolve the real path and verify it stays inside
    // the parent attachment directory.
    let realPath: string;
    try {
      realPath = resolve(realpathSync(fullPath));
    } catch {
      continue;
    }
    const resolvedDir = resolve(realpathSync(directory));
    if (!realPath.startsWith(resolvedDir + "/") && realPath !== resolvedDir) continue;
    const extension = extname(name).toLowerCase();
    let excerpt = "";
    if (TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
      try {
        excerpt = readFileSync(fullPath, "utf-8").slice(0, ATTACHMENT_EXCERPT_CHARS);
      } catch {
        excerpt = "";
      }
    }
    attachments.push({ name, kind: extension.replace(".", "") || "file", excerpt });
  }
  return attachments;
}

/** The production parent-thread loader bound into the consultation coordinator. */
export function createParentThreadLoader(baseDir: string): ParentThreadLoader {
  return {
    loadMessages: async (threadId, limit) => loadParentThreadMessages(threadId, limit),
    loadAttachments: async (threadId) => loadParentThreadAttachments(threadId, baseDir),
  };
}
