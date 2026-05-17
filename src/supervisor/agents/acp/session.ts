/**
 * ACP (Agent Client Protocol) structured session.
 *
 * Uses the official @agentclientprotocol/sdk to communicate with any
 * ACP-compatible agent CLI (e.g. `gemini --acp`) over stdio.
 *
 * Implements `StructuredSessionHandle` so the supervisor runtime drives
 * its lifecycle identically to the Codex WebSocket session — no runtime
 * changes required.
 */

import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, posix, win32 } from "node:path";
import { homedir } from "node:os";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { spawn as spawnPty, type IDisposable, type IPty } from "node-pty";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Client,
  type CompleteElicitationNotification,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type ElicitationContentValue,
  type ElicitationPropertySchema,
  type KillTerminalRequest,
  type PromptCapabilities,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type ReleaseTerminalRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionCapabilities,
  type SessionUpdate,
  type TerminalExitStatus,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import type {
  AgentSlashCommand,
  ProjectLocation,
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadAttention,
  ThreadConfig,
  ThreadServerRequestId,
  ThreadStatus,
} from "@/shared/contracts";
import { areAgentSlashCommandsEqual, isThreadConfigEqual } from "@/shared/contracts";
import { buildPromptContentBlocks } from "@/shared/promptContent";
import {
  closeOpenTurnItems,
  createAcpMapperState,
  mapAcpElicitationRequest,
  mapAcpPermissionRequest,
  mapAcpSessionUpdate,
  type AcpMapperState,
} from "./canonicalMapping";
import {
  createContextUsageEvent,
  readNonNegativeInteger,
  usageFromTokenCounts,
} from "../contextUsage";
import { terminateChildProcessTree } from "@/shared/processTree";
import {
  createKnownSessionRef,
  type AgentLaunchOptions,
  type CommandSpec,
  type CreateStructuredSessionInput,
  type StartTurnOptions,
  type StructuredSessionHandle,
  type StructuredSessionListener,
  type StructuredSessionUpdate,
} from "../base";
import { mapAcpSlashCommands, normalizeAcpModeId } from "./probe";

// ── Helpers ──────────────────────────────────────────────────────

/** CWD to pass into the ACP session (the agent's working directory). */
function resolveSessionCwd(location: ProjectLocation): string {
  switch (location.kind) {
    case "windows":
      return location.path;
    case "wsl":
      return location.linuxPath;
    case "posix":
      return location.path;
  }
}

/** CWD for the spawned process on the host OS (must be a valid native path). */
function resolveSpawnCwd(location: ProjectLocation): string | undefined {
  // WSL projects launch wsl.exe from Windows — the linux path doesn't exist
  // on the host FS. wsl.exe receives its cwd via --cd, so no spawn cwd needed.
  if (location.kind === "wsl") return undefined;
  return location.path;
}

function basenameForProjectPath(location: ProjectLocation, filePath: string): string {
  switch (location.kind) {
    case "windows":
      return win32.basename(filePath);
    case "wsl":
    case "posix":
      return posix.basename(filePath);
  }
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\");
}

export function resolveAcpResourcePath(location: ProjectLocation, rawPath: string): string {
  if (isWindowsAbsolutePath(rawPath)) {
    return rawPath;
  }
  switch (location.kind) {
    case "windows":
      return win32.join(location.path, rawPath);
    case "wsl":
      return rawPath.startsWith("/") ? rawPath : posix.join(location.linuxPath, rawPath);
    case "posix":
      return rawPath.startsWith("/") ? rawPath : posix.join(location.path, rawPath);
  }
}

function isProjectRelativePath(location: ProjectLocation, absolutePath: string): boolean {
  switch (location.kind) {
    case "windows": {
      const relative = win32.relative(location.path, absolutePath);
      return relative === "" || (!relative.startsWith("..") && !win32.isAbsolute(relative));
    }
    case "wsl": {
      const relative = posix.relative(location.linuxPath, absolutePath);
      return relative === "" || (!relative.startsWith("..") && !posix.isAbsolute(relative));
    }
    case "posix": {
      const relative = posix.relative(location.path, absolutePath);
      return relative === "" || (!relative.startsWith("..") && !posix.isAbsolute(relative));
    }
  }
}

function resolveAcpProjectPath(location: ProjectLocation, rawPath: string): string {
  const absolutePath = resolveAcpResourcePath(location, rawPath);
  if (!isProjectRelativePath(location, absolutePath)) {
    throw RequestError.invalidParams({ message: `Path is outside the project: ${rawPath}` });
  }
  return absolutePath;
}

function resolveAcpHostFsPath(location: ProjectLocation, rawPath: string): string {
  const absolutePath = resolveAcpProjectPath(location, rawPath);
  if (location.kind !== "wsl" || isWindowsAbsolutePath(absolutePath)) {
    return absolutePath;
  }
  const relative = posix.relative(location.linuxPath, absolutePath);
  return relative === ""
    ? location.uncPath
    : win32.join(location.uncPath, ...relative.split("/").filter(Boolean));
}

export function toAcpResourceUri(location: ProjectLocation, rawPath: string): string {
  const absolutePath = resolveAcpResourcePath(location, rawPath);
  if (isWindowsAbsolutePath(absolutePath)) {
    return pathToFileURL(absolutePath).href;
  }
  switch (location.kind) {
    case "windows":
      return pathToFileURL(absolutePath).href;
    case "wsl":
    case "posix":
      return new URL(`file://${absolutePath.replace(/\\/g, "/")}`).href;
  }
}

/**
 * Convert Lightcode `PromptSegment[]` + prompt text into ACP `ContentBlock[]`.
 */
async function segmentsToContentBlocks(
  prompt: string,
  location: ProjectLocation,
  segments?: PromptSegment[],
  promptCapabilities?: PromptCapabilities,
): Promise<ContentBlock[]> {
  void promptCapabilities;
  const blocks: ContentBlock[] = [];

  for (const seg of segments ?? []) {
    if (seg.kind === "attachment") {
      const resourcePath = resolveAcpResourcePath(location, seg.path);
      const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(seg.path);
      if (isImage) {
        try {
          const data = await readFile(resourcePath);
          const mimeType = seg.mimeType ?? guessMimeType(seg.path);
          blocks.push({ type: "image", data: data.toString("base64"), mimeType });
        } catch {
          // Fall back to resource link if the image bytes can't be read
          // (permission / size / missing). Capability-gating is intentionally
          // skipped — matches t3code's Cursor adapter which sends image
          // blocks unconditionally; ACP agents that don't accept images
          // should reject the prompt rather than silently dropping content.
          blocks.push({
            type: "resource_link",
            uri: toAcpResourceUri(location, seg.path),
            name: basenameForProjectPath(location, resourcePath),
            ...(seg.mimeType ? { mimeType: seg.mimeType } : {}),
          });
        }
      } else {
        blocks.push({
          type: "resource_link",
          uri: toAcpResourceUri(location, seg.path),
          name: basenameForProjectPath(location, resourcePath),
          ...(seg.mimeType ? { mimeType: seg.mimeType } : {}),
        });
      }
    } else if (seg.kind === "file") {
      const resourcePath = resolveAcpResourcePath(location, seg.path);
      blocks.push({
        type: "resource_link",
        uri: toAcpResourceUri(location, seg.path),
        name: basenameForProjectPath(location, resourcePath),
      });
    }
  }

  if (prompt.trim().length > 0) {
    blocks.push({ type: "text", text: prompt });
  }

  return blocks;
}

function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

type AcpTerminalRecord = {
  pty: IPty;
  output: string;
  outputByteLimit: number | undefined;
  truncated: boolean;
  exitStatus: TerminalExitStatus | undefined;
  waiters: Array<(status: TerminalExitStatus) => void>;
  subscriptions: IDisposable[];
};

// Cap concurrent host PTYs per ACP session. Legitimate use rarely exceeds a
// handful; the cap is a defensive bound against a misbehaving agent that
// creates terminals without releasing them and leaks file descriptors.
const MAX_ACP_TERMINALS_PER_SESSION = 32;

function truncateTerminalOutput(
  output: string,
  limit: number | undefined,
): { output: string; truncated: boolean } {
  if (limit === undefined || limit < 0 || Buffer.byteLength(output, "utf8") <= limit) {
    return { output, truncated: false };
  }
  let low = 0;
  let high = output.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (Buffer.byteLength(output.slice(mid), "utf8") <= limit) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return { output: output.slice(low), truncated: true };
}

function appendTerminalOutput(record: AcpTerminalRecord, chunk: string): void {
  const next = truncateTerminalOutput(record.output + chunk, record.outputByteLimit);
  record.output = next.output;
  record.truncated = record.truncated || next.truncated;
}

function sliceTextFileContent(
  content: string,
  line: number | null | undefined,
  limit: number | null | undefined,
): string {
  if (line == null && limit == null) return content;
  const startLine = Math.max(1, Math.trunc(line ?? 1));
  const maxLines =
    limit === undefined || limit === null ? undefined : Math.max(0, Math.trunc(limit));
  const lines = content.split(/\r?\n/u);
  const selected = lines.slice(
    startLine - 1,
    maxLines === undefined ? undefined : startLine - 1 + maxLines,
  );
  return selected.join("\n");
}

function createAcpPromptUsageEvent(threadId: string, usage: unknown): RuntimeEvent | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const obj = usage as Record<string, unknown>;
  return createContextUsageEvent(
    threadId,
    usageFromTokenCounts({
      usedTokens: readNonNegativeInteger(obj.totalTokens),
      inputTokens: readNonNegativeInteger(obj.inputTokens),
      outputTokens: readNonNegativeInteger(obj.outputTokens),
      thoughtTokens: readNonNegativeInteger(obj.thoughtTokens),
      cachedReadTokens: readNonNegativeInteger(obj.cachedReadTokens),
      cachedWriteTokens: readNonNegativeInteger(obj.cachedWriteTokens),
    }),
  );
}

/**
 * Replace the raw JSON-RPC error from `session/load` with a message the
 * renderer can show verbatim. Provider-agnostic on purpose: the same code
 * path triggers whenever any ACP agent rejects a `session/load` call (lost,
 * rotated, or never-persisted sessionId).
 */
export function rewriteLoadSessionError(error: unknown, _sessionId: string): Error {
  const detail = extractLoadSessionDetail(error);
  const message = detail.notFound
    ? "This conversation can't be resumed — the agent no longer recognizes this session. Start a new thread to continue."
    : `This conversation can't be resumed: ${detail.message ?? (error instanceof Error ? error.message : String(error))}. Start a new thread to continue.`;
  return Object.assign(new Error(message), { cause: error });
}

function extractLoadSessionDetail(error: unknown): { message?: string; notFound: boolean } {
  let message: string | undefined;
  let notFound = false;
  if (error instanceof RequestError) {
    message = error.message;
    const data = error.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") {
      message = data.message;
      if (/not\s+found/i.test(data.message)) notFound = true;
    }
  } else if (error instanceof Error) {
    message = error.message;
    if (/session.*not\s+found/i.test(error.message)) notFound = true;
  }
  return notFound
    ? { ...(message ? { message } : {}), notFound: true }
    : { ...(message ? { message } : {}), notFound: false };
}

const INTERRUPT_ACK_TEXT_TAIL_LIMIT = 512;
const USER_INTERRUPT_ACK_RE = /\boperation cancelled by user\b/i;

function appendInterruptAckTextTail(current: string, next: string): string {
  if (next.length === 0) return current;
  const combined = current.length === 0 ? next : current + next;
  return combined.slice(-INTERRUPT_ACK_TEXT_TAIL_LIMIT);
}

export function normalizeAcpStopReason(
  stopReason: string,
  input: { interruptRequested: boolean; recentAgentText?: string },
): string {
  if (
    stopReason === "end_turn" &&
    input.interruptRequested &&
    input.recentAgentText &&
    USER_INTERRUPT_ACK_RE.test(input.recentAgentText)
  ) {
    return "cancelled";
  }
  return stopReason;
}

/**
 * Resolve the ACP mode ID from Lightcode's ThreadConfig.
 *
 * Different agents expose different mode IDs:
 *   Gemini:  "default", "autoEdit", "yolo", "plan"
 *   Generic: "code", "architect", "ask"
 *
 * We pick the best match from the agent's advertised available modes.
 */
function resolveAcpMode(config: ThreadConfig, availableModeIds: string[]): string | undefined {
  const available = new Map(
    availableModeIds.map((modeId) => [normalizeAcpModeId(modeId).toLowerCase(), modeId]),
  );

  if (config.mode === "plan") {
    if (available.has("plan")) return available.get("plan");
    if (available.has("architect")) return available.get("architect");
    return undefined;
  }

  const approvalPolicy = config.approvalPolicy?.toLowerCase();
  if (approvalPolicy && available.has(approvalPolicy)) {
    return available.get(approvalPolicy);
  }

  if (config.mode === "autopilot" || config.approvalPolicy === "autopilot") {
    if (available.has("autopilot")) return available.get("autopilot");
    if (available.has("yolo")) return available.get("yolo");
  }

  // Agent mode: pick based on approval policy
  if (config.approvalPolicy === "autopilot") {
    if (available.has("autopilot")) return available.get("autopilot");
  }
  if (config.approvalPolicy === "never") {
    if (available.has("yolo")) return available.get("yolo");
    if (available.has("autopilot")) return available.get("autopilot");
  }
  if (config.approvalPolicy === "auto_edit") {
    if (available.has("autoedit")) return available.get("autoedit");
  }

  // Default agent mode
  if (available.has("agent")) return available.get("agent");
  if (available.has("default")) return available.get("default");
  if (available.has("code")) return available.get("code");

  return undefined;
}

type AcpConfigOptionLike = {
  id?: string;
  name?: string;
  category?: string | null;
  type?: string;
  currentValue?: string;
  options?: unknown;
};

type AcpConfigSelectOptionLike = {
  value?: string;
  name?: string;
};

type AcpConfigSelectGroupLike = {
  options?: unknown;
};

function findSelectConfigOption(
  configOptions: unknown,
  category: string,
): AcpConfigOptionLike | undefined {
  if (!Array.isArray(configOptions)) {
    return undefined;
  }

  return configOptions.find((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    const option = candidate as AcpConfigOptionLike;
    return option.category === category && option.type === "select";
  }) as AcpConfigOptionLike | undefined;
}

function findThoughtLevelConfig(configOptions: unknown): AcpConfigOptionLike | undefined {
  return findSelectConfigOption(configOptions, "thought_level");
}

function isSelectOption(value: unknown): value is AcpConfigSelectOptionLike {
  return typeof value === "object" && value !== null && "value" in value;
}

function flattenSelectOptions(options: unknown): AcpConfigSelectOptionLike[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.flatMap((entry) => {
    if (isSelectOption(entry)) {
      return [entry];
    }
    if (typeof entry === "object" && entry !== null && "options" in entry) {
      return flattenSelectOptions((entry as AcpConfigSelectGroupLike).options);
    }
    return [];
  });
}

function normalizeConfigOptionAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[[\]]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseBracketParams(value: string): Record<string, string> {
  const match = /\[([^\]]*)\]/.exec(value);
  const raw = match?.[1]?.trim();
  if (!raw) return {};

  const params: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const [rawKey, rawValue] = part.split("=");
    const key = rawKey?.trim();
    const val = rawValue?.trim();
    if (key && val) params[key] = val;
  }
  return params;
}

function modelOptionAliases(option: AcpConfigSelectOptionLike): string[] {
  const aliases = new Set<string>();
  const value = typeof option.value === "string" ? option.value : undefined;
  const name = typeof option.name === "string" ? option.name : undefined;

  for (const candidate of [value, name]) {
    if (candidate) aliases.add(candidate);
  }

  if (value) {
    const base = value.replace(/\[[^\]]*\]/g, "");
    if (base) aliases.add(base);
    const params = parseBracketParams(value);
    const thinking = params.thinking === "true";
    if (params.fast === "true") {
      if (base) aliases.add(`${base}-fast`);
      if (name) aliases.add(`${name}-fast`);
    }
    if (params.context && base) {
      aliases.add(`${base}-${params.context}`);
      if (params.fast === "true") {
        aliases.add(`${base}-${params.context}-fast`);
      }
    }
    const effort = params.reasoning ?? params.effort;
    if (effort && base) {
      aliases.add(`${base}-${effort}`);
      if (params.context) {
        aliases.add(`${base}-${params.context}-${effort}`);
      }
      if (effort === "xhigh") {
        aliases.add(`${base}-extra-high`);
        if (params.context) {
          aliases.add(`${base}-${params.context}-extra-high`);
        }
      } else if (effort === "extra-high") {
        aliases.add(`${base}-xhigh`);
        if (params.context) {
          aliases.add(`${base}-${params.context}-xhigh`);
        }
      }
      if (thinking) {
        aliases.add(`${base}-${effort}-thinking`);
        if (params.context) {
          aliases.add(`${base}-${params.context}-${effort}-thinking`);
        }
        if (effort === "xhigh") {
          aliases.add(`${base}-extra-high-thinking`);
          if (params.context) {
            aliases.add(`${base}-${params.context}-extra-high-thinking`);
          }
        } else if (effort === "extra-high") {
          aliases.add(`${base}-xhigh-thinking`);
          if (params.context) {
            aliases.add(`${base}-${params.context}-xhigh-thinking`);
          }
        }
      }
      if (params.fast === "true") {
        aliases.add(`${base}-${effort}-fast`);
        if (params.context) {
          aliases.add(`${base}-${params.context}-${effort}-fast`);
        }
        if (effort === "xhigh") {
          aliases.add(`${base}-extra-high-fast`);
          if (params.context) {
            aliases.add(`${base}-${params.context}-extra-high-fast`);
          }
        } else if (effort === "extra-high") {
          aliases.add(`${base}-xhigh-fast`);
          if (params.context) {
            aliases.add(`${base}-${params.context}-xhigh-fast`);
          }
        }
        if (thinking) {
          aliases.add(`${base}-${effort}-thinking-fast`);
          if (params.context) {
            aliases.add(`${base}-${params.context}-${effort}-thinking-fast`);
          }
          if (effort === "xhigh") {
            aliases.add(`${base}-extra-high-thinking-fast`);
            if (params.context) {
              aliases.add(`${base}-${params.context}-extra-high-thinking-fast`);
            }
          } else if (effort === "extra-high") {
            aliases.add(`${base}-xhigh-thinking-fast`);
            if (params.context) {
              aliases.add(`${base}-${params.context}-xhigh-thinking-fast`);
            }
          }
        }
      }
    }
    if (base === "default") {
      aliases.add("auto");
    }
  }

  if (name?.toLowerCase() === "auto") {
    aliases.add("auto");
  }

  return [...aliases].map(normalizeConfigOptionAlias);
}

function modelConfigTargetAliases(config: ThreadConfig): string[] {
  const aliases = new Set<string>();
  const modelId = config.model;
  if (!modelId) {
    return [];
  }

  const effortAliases =
    config.effort === "xhigh" ? ["xhigh", "extra-high"] : config.effort ? [config.effort] : [];
  const contextPrefixes =
    config.contextSize && config.contextSize !== "default"
      ? [`${modelId}-${config.contextSize}`]
      : [];
  const modelPrefixes = [...contextPrefixes, modelId];

  for (const prefix of modelPrefixes) {
    for (const effort of effortAliases) {
      if (config.fast === true) {
        if (config.thinking === true) {
          aliases.add(`${prefix}-${effort}-thinking-fast`);
        }
        aliases.add(`${prefix}-${effort}-fast`);
      }
      if (config.thinking === true) {
        aliases.add(`${prefix}-${effort}-thinking`);
      }
      aliases.add(`${prefix}-${effort}`);
    }
    if (config.fast === true) {
      if (config.thinking === true) {
        aliases.add(`${prefix}-thinking-fast`);
      }
      aliases.add(`${prefix}-fast`);
    }
    if (config.thinking === true) {
      aliases.add(`${prefix}-thinking`);
    }
    aliases.add(prefix);
  }

  return [...aliases].map(normalizeConfigOptionAlias);
}

function resolveModelConfigValue(
  config: ThreadConfig,
  configOptions: unknown,
): { configId: string; value: string; currentValue?: string } | undefined {
  const targets = modelConfigTargetAliases(config);
  if (targets.length === 0) {
    return undefined;
  }
  const option = findSelectConfigOption(configOptions, "model");
  if (!option?.id) {
    return undefined;
  }

  const candidates = flattenSelectOptions(option.options);
  const match = targets
    .map((target) =>
      candidates.find((candidate) =>
        modelOptionAliases(candidate).some((alias) => alias === target),
      ),
    )
    .find((candidate) => candidate !== undefined);
  const value = typeof match?.value === "string" ? match.value : undefined;
  if (!value) {
    return undefined;
  }

  return {
    configId: option.id,
    value,
    ...(option.currentValue ? { currentValue: option.currentValue } : {}),
  };
}

function applyAcpModeUpdateToConfig(currentConfig: ThreadConfig, modeId: string): ThreadConfig {
  const normalized = normalizeAcpModeId(modeId).toLowerCase();

  if (normalized === "plan" || normalized === "architect") {
    return { ...currentConfig, mode: "plan" };
  }

  if (normalized === "autoedit") {
    return { ...currentConfig, mode: "agent", approvalPolicy: "auto_edit" };
  }

  if (normalized === "autopilot") {
    return {
      ...currentConfig,
      mode: "agent",
      approvalPolicy: currentConfig.approvalPolicy === "autopilot" ? "autopilot" : "never",
    };
  }

  if (normalized === "yolo") {
    return { ...currentConfig, mode: "agent", approvalPolicy: "never" };
  }

  if (normalized !== "agent" && normalized !== "default" && normalized !== "code") {
    return { ...currentConfig, mode: "agent", approvalPolicy: normalizeAcpModeId(modeId) };
  }

  return {
    ...currentConfig,
    mode: "agent",
    approvalPolicy: currentConfig.approvalPolicy === undefined ? undefined : "default",
  };
}

// ── Session ──────────────────────────────────────────────────────

export interface AcpStructuredSessionOptions {
  /**
   * Hook the adapter passes in when it wants to control the message a failed
   * `session/load` produces. Receives the raw transport error and the
   * sessionId that was being loaded; must return the Error to throw.
   */
  loadSessionErrorRewriter?: (error: unknown, sessionId: string) => Error;
}

export class AcpStructuredSession implements StructuredSessionHandle {
  launchOptions: AgentLaunchOptions;

  private loadSessionErrorRewriter: (error: unknown, sessionId: string) => Error =
    rewriteLoadSessionError;

  private readonly child: ChildProcess;
  private readonly connection: ClientSideConnection;
  private readonly cwd: string;
  private readonly projectLocation: ProjectLocation;
  /** Lightcode thread id (stable identifier we report in RuntimeEvents). */
  private readonly threadId: string;
  private readonly stderrChunks: string[] = [];
  private listener: StructuredSessionListener | undefined;
  private sessionId: string | undefined;
  private isDisposed = false;
  private currentConfig: ThreadConfig | undefined;
  private currentSlashCommands: AgentSlashCommand[] | undefined;
  private currentStatus: ThreadStatus = "idle";
  private currentAttention: ThreadAttention = "none";
  private spawnReady: Promise<void> = Promise.resolve();
  private currentTurnId: string | undefined;
  private stableSessionRef: SessionRef | undefined;
  /**
   * True while a `connection.prompt()` call is in flight (between issue and
   * resolution). Used together with `pendingPromptInterrupt` to close the
   * window where `interruptTurn()` fires before the ACP runtime has actually
   * accepted the prompt — without this, `connection.cancel()` lands on an
   * idle session and is silently dropped, so the steer would be lost.
   * Mirrors Codex's `pendingTurnInterrupt` race guard at codex/acp.ts:264.
   */
  private promptInFlight = false;
  private pendingPromptInterrupt = false;
  private currentTurnInterruptRequested = false;
  private recentInterruptAckTextTail = "";
  private availableModeIds: string[] = [];
  private currentConfigOptions: unknown[] = [];
  private modeConfigId: string | undefined;
  private modelConfigValue: string | undefined;
  private thoughtLevelConfigId: string | undefined;
  private agentPromptCapabilities: PromptCapabilities | undefined;
  private agentSessionCapabilities: SessionCapabilities | undefined;
  private readonly acpTerminals = new Map<string, AcpTerminalRecord>();
  private acpTerminalSeq = 0;

  private mapperState: AcpMapperState | undefined;
  /**
   * Runtime events that fired before the listener was wired (typical race:
   * the supervisor calls `void startTurn(...)` and then `await`s plugin-env
   * resolution, which lets the turn's microtask emit user_message events
   * before `spawnThread` reaches `setListener`). Replayed on `setListener`.
   */
  private bufferedRuntimeEvents: RuntimeEvent[] = [];
  /**
   * True while `loadSession` is replaying historical `session/update`
   * notifications. Lightcode persists thread history in its own DB, so
   * surfacing the replay as new canonical events would duplicate every
   * message in the chat pane. We drop ACP→canonical mapping for the duration
   * and let normal mapping resume once the load completes.
   */
  private isReplayingHistory = false;
  private replayHistoryUntil = 0;

  private constructor(
    child: ChildProcess,
    connection: ClientSideConnection,
    projectLocation: ProjectLocation,
    cwd: string,
    threadId: string,
    options?: AcpStructuredSessionOptions,
  ) {
    this.child = child;
    this.connection = connection;
    this.projectLocation = projectLocation;
    this.cwd = cwd;
    this.threadId = threadId;
    this.launchOptions = { suppressResumeConfigOverrides: true };
    if (options?.loadSessionErrorRewriter) {
      this.loadSessionErrorRewriter = options.loadSessionErrorRewriter;
    }
  }

  /** Initialize the canonical mapper once we have a stable thread id. */
  private ensureMapperState(): AcpMapperState {
    if (!this.mapperState || this.mapperState.threadId !== this.threadId) {
      this.mapperState = createAcpMapperState(this.threadId);
    }
    return this.mapperState;
  }

  private emitRuntimeEvents(events: RuntimeEvent[]): void {
    if (events.length === 0) return;
    if (!this.listener?.onRuntimeEvent) {
      this.bufferedRuntimeEvents.push(...events);
      return;
    }
    for (const event of events) {
      this.listener.onRuntimeEvent(event);
    }
  }

  private emitListenerUpdate(update: StructuredSessionUpdate): void {
    this.currentStatus = update.status;
    this.currentAttention = update.attention;
    this.listener?.onUpdate(update);
  }

  private emitCurrentState(listener: StructuredSessionListener): void {
    const sessionRef = this.currentSessionRef();
    listener.onUpdate({
      status: this.currentStatus,
      attention: this.currentAttention,
      ...(this.currentConfig ? { config: this.currentConfig } : {}),
      ...(sessionRef ? { sessionRef } : {}),
      ...(this.currentSlashCommands !== undefined
        ? { slashCommands: this.currentSlashCommands }
        : {}),
    });
  }

  private updateSlashCommands(commands: AgentSlashCommand[]): void {
    if (areAgentSlashCommandsEqual(this.currentSlashCommands, commands)) {
      return;
    }
    this.currentSlashCommands = commands;
    const sessionRef = this.currentSessionRef();
    this.emitListenerUpdate({
      status: this.currentStatus,
      attention: this.currentAttention,
      ...(this.currentConfig ? { config: this.currentConfig } : {}),
      ...(sessionRef ? { sessionRef } : {}),
      slashCommands: commands,
    });
  }

  private currentSessionRef(): SessionRef | undefined {
    if (!this.sessionId) return undefined;
    if (this.stableSessionRef?.providerSessionId !== this.sessionId) {
      this.stableSessionRef = createKnownSessionRef(this.sessionId);
    }
    return this.stableSessionRef;
  }

  private adoptSessionRef(sessionRef: SessionRef): void {
    this.sessionId = sessionRef.providerSessionId;
    this.stableSessionRef = sessionRef;
  }

  private rememberSessionOptions(availableModeIds: string[], configOptions: unknown): void {
    this.availableModeIds = availableModeIds;
    this.currentConfigOptions = Array.isArray(configOptions) ? configOptions : [];
    this.modeConfigId = findSelectConfigOption(configOptions, "mode")?.id;
    const modelConfig = findSelectConfigOption(configOptions, "model");
    this.modelConfigValue = modelConfig?.currentValue;
    this.thoughtLevelConfigId = findThoughtLevelConfig(configOptions)?.id;
  }

  private async applyTurnConfig(config: ThreadConfig): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    const previousConfig = this.currentConfig;
    const nextModeId = resolveAcpMode(config, this.availableModeIds);
    const previousModeId = previousConfig
      ? resolveAcpMode(previousConfig, this.availableModeIds)
      : undefined;

    if (nextModeId && nextModeId !== previousModeId && this.modeConfigId) {
      try {
        const result = await this.connection.setSessionConfigOption({
          sessionId: this.sessionId,
          configId: this.modeConfigId,
          value: nextModeId,
        });
        this.rememberSessionOptions(this.availableModeIds, result.configOptions);
        console.log("[acp] mode config set to:", nextModeId);
      } catch (error) {
        console.log(
          "[acp] live mode config change rejected, continuing: %s",
          error instanceof Error ? error.message : String(error),
        );
      }
    } else if (nextModeId && nextModeId !== previousModeId) {
      try {
        await this.connection.setSessionMode({ sessionId: this.sessionId, modeId: nextModeId });
        console.log("[acp] mode set to:", nextModeId);
      } catch (error) {
        console.log(
          "[acp] live mode change rejected, continuing: %s",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const modelConfig = resolveModelConfigValue(config, this.currentConfigOptions);
    if (
      config.model !== previousConfig?.model ||
      (modelConfig && modelConfig.value !== this.modelConfigValue)
    ) {
      if (modelConfig) {
        try {
          const result = await this.connection.setSessionConfigOption({
            sessionId: this.sessionId,
            configId: modelConfig.configId,
            value: modelConfig.value,
          });
          this.rememberSessionOptions(this.availableModeIds, result.configOptions);
          console.log("[acp] model config set to:", modelConfig.value);
        } catch (error) {
          console.log(
            "[acp] live model config change rejected, continuing: %s",
            error instanceof Error ? error.message : String(error),
          );
        }
      } else {
        try {
          await this.connection.unstable_setSessionModel({
            sessionId: this.sessionId,
            modelId: config.model,
          });
          console.log("[acp] model set to:", config.model);
        } catch (error) {
          console.log(
            "[acp] live model change rejected, continuing: %s",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (config.effort && this.thoughtLevelConfigId && config.effort !== previousConfig?.effort) {
      try {
        await this.connection.setSessionConfigOption({
          sessionId: this.sessionId,
          configId: this.thoughtLevelConfigId,
          value: config.effort,
        });
        console.log("[acp] effort set to:", config.effort);
      } catch (error) {
        console.log(
          "[acp] live effort change rejected, continuing: %s",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    this.currentConfig = config;
  }

  /**
   * Spawn the ACP agent process and create a session handle.
   *
   * The `command` should launch the CLI in ACP mode (e.g. `gemini --acp`).
   * The SDK communicates over stdin/stdout using newline-delimited JSON.
   */
  static create(
    command: CommandSpec,
    projectLocation: ProjectLocation,
    threadId: string,
    options?: AcpStructuredSessionOptions,
  ): AcpStructuredSession {
    const sessionCwd = resolveSessionCwd(projectLocation);
    const spawnCwd = command.cwd ?? resolveSpawnCwd(projectLocation);

    const child = spawnChild(command.command, command.args, {
      ...(spawnCwd ? { cwd: spawnCwd } : {}),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color", ...(command.env ?? {}) },
      shell: false,
      windowsHide: true,
    });

    // Track spawn outcome — activate() awaits this before writing to stdin.
    const spawnReady = new Promise<void>((resolve, reject) => {
      child.on("error", (err) => {
        console.log("[acp] spawn error:", err.message);
        reject(new Error(`ACP agent failed to start: ${err.message}`));
      });
      child.on("spawn", resolve);
    });

    // Collect stderr for error diagnostics
    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      console.log("[acp stderr]", text.trimEnd());
      stderrChunks.push(text);
      if (stderrChunks.length > 20) stderrChunks.shift();
    });

    // Wrap Node.js streams into Web Streams for the ACP SDK.
    // The Node.js → Web Stream adapters produce compatible types but
    // tsgo's strict generics require explicit casts.
    const toAgent = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
    const fromAgent = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(toAgent, fromAgent);

    let session: AcpStructuredSession;

    const connection = new ClientSideConnection(
      (_agent): Client => ({
        requestPermission(params: RequestPermissionRequest) {
          return session.handlePermissionRequest(params);
        },
        unstable_createElicitation(params: CreateElicitationRequest) {
          return session.handleElicitationRequest(params);
        },
        unstable_completeElicitation(params: CompleteElicitationNotification) {
          session.handleElicitationComplete(params);
          return Promise.resolve();
        },
        sessionUpdate(params: SessionNotification) {
          session.handleSessionUpdate(params);
          return Promise.resolve();
        },
        async readTextFile(params) {
          return session.handleReadTextFile(params);
        },
        async writeTextFile(params) {
          return session.handleWriteTextFile(params);
        },
        async createTerminal(params: CreateTerminalRequest) {
          return session.handleCreateTerminal(params);
        },
        async terminalOutput(params: TerminalOutputRequest) {
          return session.handleTerminalOutput(params);
        },
        async releaseTerminal(params: ReleaseTerminalRequest) {
          session.handleReleaseTerminal(params);
          return {};
        },
        waitForTerminalExit(params: WaitForTerminalExitRequest) {
          return session.handleWaitForTerminalExit(params);
        },
        async killTerminal(params: KillTerminalRequest) {
          session.handleKillTerminal(params);
          return {};
        },
      }),
      stream,
    );

    session = new AcpStructuredSession(
      child,
      connection,
      projectLocation,
      sessionCwd,
      threadId,
      options,
    );
    session.spawnReady = spawnReady;
    session.stderrChunks.push(...stderrChunks);

    // Handle connection close
    void connection.closed.then(() => {
      if (!session.isDisposed) {
        session.listener?.onClose();
      }
    });

    child.once("exit", (code) => {
      // Quiet path: the structured session is one-shot for adapters whose
      // `liveInputMode === "terminal"` (every adapter today). The runtime
      // disposes us once `openThread` returns, and some agents (OpenCode)
      // exit non-zero on stdin close even when everything went fine —
      // there's nothing actionable to surface in that case.
      const expected = session.isDisposed || session.sessionId !== undefined;
      if (expected) {
        console.log(`[acp] child exited (code ${code})`);
      } else {
        console.log(`[acp] child exited unexpectedly (code ${code})`);
      }
      if (!session.isDisposed) {
        session.listener?.onClose();
      }
    });

    return session;
  }

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;

    // Drain any runtime events that landed before the listener was wired
    // (turn.started / user_message from startTurn typically race ahead of
    // spawnThread's setListener call).
    if (listener.onRuntimeEvent && this.bufferedRuntimeEvents.length > 0) {
      const drained = this.bufferedRuntimeEvents;
      this.bufferedRuntimeEvents = [];
      for (const event of drained) {
        listener.onRuntimeEvent(event);
      }
    }

    // Re-emit current state for late listeners
    if (this.sessionId || this.currentConfig || this.currentSlashCommands !== undefined) {
      this.emitCurrentState(listener);
    }
  }

  /**
   * Phase 1: Initialize the ACP protocol handshake.
   */
  async activate(): Promise<void> {
    if (this.isDisposed) {
      throw new Error("ACP session was disposed before activation.");
    }
    await this.spawnReady;

    console.log("[acp] sending initialize...");
    const initResult = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "lightcode", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        elicitation: { form: {}, url: {} },
        terminal: true,
      },
    });
    this.agentPromptCapabilities = initResult.agentCapabilities?.promptCapabilities;
    this.agentSessionCapabilities = initResult.agentCapabilities?.sessionCapabilities;
    console.log(
      "[acp] initialized — protocol v%d, agent: %s",
      initResult.protocolVersion,
      initResult.agentInfo?.name ?? "unknown",
    );

    if (initResult.authMethods?.length) {
      console.log("[acp] agent advertised auth methods:", initResult.authMethods.length);
    }
  }

  /**
   * Phase 2: Create or resume an ACP session.
   *
   * The agent's response includes its available modes and models.
   * We store them to map Lightcode's `ThreadConfig` to the correct
   * ACP mode/model IDs (which vary per agent).
   */
  async openThread(config: ThreadConfig, sessionRef?: SessionRef): Promise<string> {
    let availableModeIds: string[] = [];
    let configOptions: unknown[] = [];
    this.currentConfig = undefined;
    this.currentSlashCommands = undefined;

    if (sessionRef) {
      if (this.agentSessionCapabilities?.resume !== undefined) {
        console.log("[acp] resuming session:", sessionRef.providerSessionId);
        try {
          const result = await this.connection.resumeSession({
            sessionId: sessionRef.providerSessionId,
            cwd: this.cwd,
            mcpServers: [],
          });
          this.adoptSessionRef(sessionRef);
          availableModeIds = result.modes?.availableModes?.map((m) => m.id) ?? [];
          configOptions = result.configOptions ?? [];
        } catch (error) {
          throw this.loadSessionErrorRewriter(error, sessionRef.providerSessionId);
        }
      } else {
        console.log("[acp] loading session:", sessionRef.providerSessionId);
        this.isReplayingHistory = true;
        this.replayHistoryUntil = Infinity;
        try {
          const result = await this.connection.loadSession({
            sessionId: sessionRef.providerSessionId,
            cwd: this.cwd,
            mcpServers: [],
          });
          this.adoptSessionRef(sessionRef);
          availableModeIds = result.modes?.availableModes?.map((m) => m.id) ?? [];
          configOptions = result.configOptions ?? [];
        } catch (error) {
          throw this.loadSessionErrorRewriter(error, sessionRef.providerSessionId);
        } finally {
          this.isReplayingHistory = false;
          this.replayHistoryUntil = Date.now() + 500;
        }
      }
    } else {
      console.log("[acp] creating new session in", this.cwd);
      const result = await this.connection.newSession({
        cwd: this.cwd,
        mcpServers: [],
      });
      this.sessionId = result.sessionId;
      this.stableSessionRef = createKnownSessionRef(result.sessionId);
      availableModeIds = result.modes?.availableModes?.map((m) => m.id) ?? [];
      configOptions = result.configOptions ?? [];
      console.log("[acp] session created:", this.sessionId, "modes:", availableModeIds);
    }

    this.rememberSessionOptions(availableModeIds, configOptions);
    await this.applyTurnConfig(config);

    if (this.sessionId) {
      this.launchOptions = { ...this.launchOptions, resumeThreadId: this.sessionId };
    }
    return this.sessionId!;
  }

  /**
   * Phase 3: Send a prompt to the agent.
   *
   * `prompt()` is async and resolves when the turn completes (the agent
   * returns a `stopReason`). During the turn, `session/update` notifications
   * flow through `handleSessionUpdate` which emits status updates.
   */
  async startTurn(
    prompt: string,
    config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    if (!this.sessionId) {
      throw new Error("ACP session not opened yet.");
    }
    this.currentTurnInterruptRequested = false;
    this.recentInterruptAckTextTail = "";

    await this.applyTurnConfig(config);

    // Mark a new canonical turn and surface the user-typed message as a
    // user_message item (the prompt itself doesn't generate a session/update).
    // When the runtime has already pushed an optimistic user_message ahead of
    // structured-session setup, we reuse the same item id so the renderer's
    // per-id dedupe drops this duplicate emit.
    this.currentTurnId = `turn-${randomUUID()}`;
    const userItemId = options?.userMessageItemId ?? `user-${this.currentTurnId}`;
    this.emitRuntimeEvents([
      { type: "turn.started", threadId: this.threadId, turnId: this.currentTurnId },
      {
        type: "item.started",
        threadId: this.threadId,
        itemId: userItemId,
        itemType: "user_message",
        payload: {
          content: buildPromptContentBlocks(prompt, segments),
        },
      },
      { type: "item.completed", threadId: this.threadId, itemId: userItemId },
    ]);

    // Signal working state immediately
    this.emitListenerUpdate({ status: "working", attention: "working" });

    const contentBlocks = await segmentsToContentBlocks(
      prompt,
      this.projectLocation,
      segments,
      this.agentPromptCapabilities,
    );

    try {
      this.promptInFlight = true;
      // If `interruptTurn()` was called between `startTurn` entry and this
      // point (rare, but possible: the supervisor stages a steer immediately
      // after a previous turn ended), fire the cancel now so the agent
      // doesn't process this prompt.
      if (this.pendingPromptInterrupt && this.sessionId) {
        this.pendingPromptInterrupt = false;
        await this.connection.cancel({ sessionId: this.sessionId });
      }
      const result = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: contentBlocks,
      });
      const usageEvent = createAcpPromptUsageEvent(this.threadId, result.usage);
      if (usageEvent) this.emitRuntimeEvents([usageEvent]);

      // Map stopReason to Lightcode status
      const normalizedStopReason = normalizeAcpStopReason(result.stopReason, {
        interruptRequested: this.currentTurnInterruptRequested,
        recentAgentText: this.recentInterruptAckTextTail,
      });
      const { status, attention } = this.mapStopReason(normalizedStopReason);
      this.emitListenerUpdate({ status, attention });

      // Close any items still open at end-of-turn and emit turn.completed.
      const mapperState = this.ensureMapperState();
      this.emitRuntimeEvents([
        ...closeOpenTurnItems(mapperState),
        {
          type: "turn.completed",
          threadId: this.threadId,
          turnId: this.currentTurnId,
          state: normalizedStopReason === "cancelled" ? "cancelled" : "completed",
        },
      ]);
    } catch (error) {
      if (this.isDisposed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.emitListenerUpdate({ status: "error", attention: "error", errorMessage: message });
      const mapperState = this.ensureMapperState();
      this.emitRuntimeEvents([
        ...closeOpenTurnItems(mapperState),
        { type: "error", threadId: this.threadId, message },
        ...(this.currentTurnId
          ? ([
              {
                type: "turn.completed",
                threadId: this.threadId,
                turnId: this.currentTurnId,
                state: "failed",
              },
            ] as RuntimeEvent[])
          : []),
      ]);
    } finally {
      this.promptInFlight = false;
      this.pendingPromptInterrupt = false;
      this.currentTurnInterruptRequested = false;
      this.recentInterruptAckTextTail = "";
    }
  }

  /**
   * Respond to a permission request from the agent.
   */
  async resolveServerRequest(requestId: ThreadServerRequestId, response: unknown): Promise<void> {
    // The permission response is stored and resolved by the pending promise
    // in handlePermissionRequest. The runtime calls this with the user's
    // chosen option.
    const resolver = this.pendingPermissionResolvers.get(requestId);
    if (resolver) {
      this.pendingPermissionResolvers.delete(requestId);
      resolver(response);
      return;
    }
    this.resolvePendingElicitationRequest(requestId, response);
  }

  async interruptTurn(): Promise<void> {
    if (!this.sessionId || this.isDisposed) {
      return;
    }

    this.cancelPendingServerRequests();
    this.currentTurnInterruptRequested = true;
    // Race guard: if interrupt fires before `connection.prompt()` has been
    // entered (e.g. the supervisor stages a steer in the same microtask as
    // a fresh startTurn), set a flag instead of issuing the cancel directly.
    // The cancel would land on an idle session and be silently ignored;
    // `startTurn` checks the flag right before awaiting `prompt()` and fires
    // the cancel from there. Mirrors codex/acp.ts:584-599.
    if (!this.promptInFlight) {
      this.pendingPromptInterrupt = true;
      return;
    }
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.cancelPendingServerRequests();
    this.releaseAllAcpTerminals();

    if (this.sessionId && this.agentSessionCapabilities?.close !== undefined) {
      try {
        await this.connection.closeSession({ sessionId: this.sessionId });
      } catch (error) {
        console.warn("[acp] session/close failed during dispose:", error);
      }
    }

    // Don't send cancel — the ACP process may not be generating,
    // and the connection may already be closing. Just kill the process.

    if (!this.child.killed) {
      terminateChildProcessTree(this.child);
    }
  }

  // ── Resume artifacts ──────────────────────────────────────────

  /**
   * Wait for the session file to appear on disk.
   *
   * Called by the runtime AFTER `startTurn` fires the initial prompt.
   * Gemini's ACP mode persists the session to disk during prompt processing.
   * The TUI needs this file to exist before `--resume <id>` will work.
   *
   * Polls `~/.gemini/tmp/<project>/chats/` for a file containing the session UUID.
   */
  async ensureResumeArtifacts(): Promise<void> {
    if (!this.sessionId) return;

    const projectName = basename(this.cwd);
    const chatsDir = join(homedir(), ".gemini", "tmp", projectName, "chats");
    const uuid8 = this.sessionId.split("-")[0] ?? this.sessionId.slice(0, 8);

    console.log("[acp] waiting for session file (uuid prefix: %s)...", uuid8);

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const { readdirSync } = await import("node:fs");
        const files = readdirSync(chatsDir);
        const match = files.find((f) => f.includes(uuid8) && f.endsWith(".json"));
        if (match) {
          console.log("[acp] session file found:", join(chatsDir, match));
          return;
        }
      } catch {
        // Directory may not exist yet
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    console.log("[acp] session file not found after timeout, proceeding anyway");
  }

  // ── Internal handlers ────────────────────────────────────────

  private assertRequestSession(sessionId: string): void {
    if (!this.sessionId || sessionId !== this.sessionId) {
      throw RequestError.invalidParams({ message: `Unknown ACP session: ${sessionId}` });
    }
  }

  private async handleReadTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    this.assertRequestSession(params.sessionId);
    const path = resolveAcpHostFsPath(this.projectLocation, params.path);
    const fullContent = await readFile(path, "utf8");
    const content = sliceTextFileContent(fullContent, params.line, params.limit);
    return { content };
  }

  private async handleWriteTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    this.assertRequestSession(params.sessionId);
    const path = resolveAcpHostFsPath(this.projectLocation, params.path);
    await writeFile(path, params.content, "utf8");
    return {};
  }

  private handleCreateTerminal(params: CreateTerminalRequest): CreateTerminalResponse {
    this.assertRequestSession(params.sessionId);
    if (this.acpTerminals.size >= MAX_ACP_TERMINALS_PER_SESSION) {
      throw RequestError.invalidParams({
        message: `ACP terminal limit reached (${MAX_ACP_TERMINALS_PER_SESSION}); release existing terminals before creating more.`,
      });
    }
    const terminalId = `acp-terminal-${this.acpTerminalSeq++}`;
    const cwd = params.cwd
      ? resolveAcpHostFsPath(this.projectLocation, params.cwd)
      : resolveAcpHostFsPath(this.projectLocation, this.cwd);
    const env = { ...process.env };
    for (const entry of params.env ?? []) {
      env[entry.name] = entry.value;
    }
    const outputByteLimit =
      typeof params.outputByteLimit === "number" ? params.outputByteLimit : undefined;
    const pty = spawnPty(params.command, params.args ?? [], {
      cwd,
      env,
      cols: 80,
      rows: 24,
    });
    const record: AcpTerminalRecord = {
      pty,
      output: "",
      outputByteLimit,
      truncated: false,
      exitStatus: undefined,
      waiters: [],
      subscriptions: [],
    };
    this.acpTerminals.set(terminalId, record);
    record.subscriptions.push(pty.onData((data) => appendTerminalOutput(record, data)));
    record.subscriptions.push(
      pty.onExit((event) => {
        record.exitStatus = {
          exitCode: event.exitCode,
          ...(event.signal ? { signal: String(event.signal) } : {}),
        };
        const waiters = record.waiters.splice(0);
        for (const resolve of waiters) {
          resolve(record.exitStatus);
        }
      }),
    );
    return { terminalId };
  }

  private handleTerminalOutput(params: TerminalOutputRequest): TerminalOutputResponse {
    this.assertRequestSession(params.sessionId);
    const record = this.getAcpTerminal(params.terminalId);
    return {
      output: record.output,
      truncated: record.truncated,
      ...(record.exitStatus ? { exitStatus: record.exitStatus } : {}),
    };
  }

  private handleReleaseTerminal(params: ReleaseTerminalRequest): void {
    this.assertRequestSession(params.sessionId);
    const record = this.getAcpTerminal(params.terminalId);
    this.disposeAcpTerminal(params.terminalId, record);
  }

  private async handleWaitForTerminalExit(
    params: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    this.assertRequestSession(params.sessionId);
    const record = this.getAcpTerminal(params.terminalId);
    if (record.exitStatus) return record.exitStatus;
    return new Promise((resolve) => {
      record.waiters.push(resolve);
    });
  }

  private handleKillTerminal(params: KillTerminalRequest): void {
    this.assertRequestSession(params.sessionId);
    const record = this.getAcpTerminal(params.terminalId);
    if (!record.exitStatus) {
      record.pty.kill();
    }
  }

  private getAcpTerminal(terminalId: string): AcpTerminalRecord {
    const record = this.acpTerminals.get(terminalId);
    if (!record) {
      throw RequestError.invalidParams({ message: `Unknown ACP terminal: ${terminalId}` });
    }
    return record;
  }

  private releaseAllAcpTerminals(): void {
    for (const [terminalId, record] of [...this.acpTerminals]) {
      this.disposeAcpTerminal(terminalId, record);
    }
  }

  private disposeAcpTerminal(terminalId: string, record: AcpTerminalRecord): void {
    this.acpTerminals.delete(terminalId);
    for (const subscription of record.subscriptions.splice(0)) {
      subscription.dispose();
    }
    if (!record.exitStatus) {
      record.pty.kill();
    }
    const status = record.exitStatus ?? { signal: "SIGTERM" };
    const waiters = record.waiters.splice(0);
    for (const resolve of waiters) {
      resolve(status);
    }
  }

  private readonly pendingPermissionResolvers = new Map<
    ThreadServerRequestId,
    (response: unknown) => void
  >();
  private readonly pendingElicitationResolvers = new Map<
    ThreadServerRequestId,
    { resolve: (response: unknown) => void; elicitationId?: string }
  >();
  private readonly pendingElicitationRequestIdsByElicitationId = new Map<
    string,
    ThreadServerRequestId
  >();

  private permissionRequestSeq = 0;
  private elicitationRequestSeq = 0;

  private cancelPendingServerRequests(): void {
    const cancelledIds: ThreadServerRequestId[] = [];
    for (const [requestId, resolver] of this.pendingPermissionResolvers) {
      cancelledIds.push(requestId);
      resolver({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissionResolvers.clear();
    for (const [requestId, entry] of this.pendingElicitationResolvers) {
      cancelledIds.push(requestId);
      if (entry.elicitationId !== undefined) {
        this.pendingElicitationRequestIdsByElicitationId.delete(entry.elicitationId);
      }
      entry.resolve({ action: "cancel" });
    }
    this.pendingElicitationResolvers.clear();
    if (cancelledIds.length > 0) {
      this.emitRuntimeEvents(
        cancelledIds.map((requestId) => ({
          type: "request.resolved",
          threadId: this.threadId,
          requestId: String(requestId),
          outcome: "cancelled",
        })),
      );
    }
  }

  private resolvePendingElicitationRequest(
    requestId: ThreadServerRequestId,
    response: unknown,
  ): boolean {
    const entry = this.pendingElicitationResolvers.get(requestId);
    if (!entry) return false;
    this.pendingElicitationResolvers.delete(requestId);
    if (entry.elicitationId !== undefined) {
      this.pendingElicitationRequestIdsByElicitationId.delete(entry.elicitationId);
    }
    entry.resolve(response);
    return true;
  }

  /**
   * Handle `requestPermission` calls from the agent.
   *
   * Maps ACP permission requests to Lightcode's `ThreadServerRequest` system.
   * The agent blocks until we respond — we create a pending promise and emit
   * the request to the UI via the listener.
   */
  private handlePermissionRequest(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    // Client-side bypass for agents that don't expose a yolo/autopilot mode.
    // When the user selects "never" approval policy, auto-resolve without
    // emitting to the UI. Agents that DO expose a bypass mode are switched
    // into it before turn-start, so they won't call requestPermission in the
    // first place — this branch only fires when the agent forwarded the
    // prompt anyway.
    if (this.currentConfig?.approvalPolicy === "never") {
      const allow =
        params.options.find((opt) => opt.kind === "allow_always") ??
        params.options.find((opt) => opt.kind === "allow_once");
      if (allow) {
        return Promise.resolve({
          outcome: { outcome: "selected", optionId: allow.optionId },
        });
      }
    }

    return new Promise<RequestPermissionResponse>((resolve) => {
      const requestId = `acp-perm-${this.permissionRequestSeq++}`;

      this.pendingPermissionResolvers.set(requestId, (response: unknown) => {
        const resp = response as { optionId?: string } | undefined;
        if (resp?.optionId) {
          resolve({ outcome: { outcome: "selected", optionId: resp.optionId } });
        } else {
          resolve({ outcome: { outcome: "cancelled" } });
        }
      });

      // Emit a canonical request.opened — the composer-level runtime-request
      // panel renders it and resolves through `bridge.resolveThreadServerRequest`
      // → `resolveServerRequest()` here.
      const mapperState = this.ensureMapperState();
      this.emitRuntimeEvents([mapAcpPermissionRequest(params, mapperState, String(requestId))]);

      // Also signal that the thread needs approval
      this.emitListenerUpdate({ status: "needs_approval", attention: "needs_approval" });
    });
  }

  private handleElicitationRequest(
    params: CreateElicitationRequest,
  ): Promise<CreateElicitationResponse> {
    return new Promise<CreateElicitationResponse>((resolve) => {
      const requestId = `acp-elicit-${this.elicitationRequestSeq++}`;
      const urlElicitationId = params.mode === "url" ? params.elicitationId : undefined;

      this.pendingElicitationResolvers.set(requestId, {
        resolve: (response: unknown) => {
          resolve(normalizeAcpElicitationResponse(response, params));
        },
        ...(urlElicitationId !== undefined ? { elicitationId: urlElicitationId } : {}),
      });

      if (urlElicitationId !== undefined) {
        this.pendingElicitationRequestIdsByElicitationId.set(urlElicitationId, requestId);
      }

      const mapperState = this.ensureMapperState();
      this.emitRuntimeEvents([mapAcpElicitationRequest(params, mapperState, String(requestId))]);
      this.emitListenerUpdate({ status: "needs_reply", attention: "needs_reply" });
    });
  }

  private handleElicitationComplete(params: CompleteElicitationNotification): void {
    const requestId = this.pendingElicitationRequestIdsByElicitationId.get(params.elicitationId);
    if (!requestId) return;
    if (this.resolvePendingElicitationRequest(requestId, { action: "accept" })) {
      this.emitRuntimeEvents([
        {
          type: "request.resolved",
          threadId: this.threadId,
          requestId: String(requestId),
          outcome: "answered",
        },
      ]);
    }
  }

  /**
   * Handle `session/update` notifications from the agent.
   *
   * These are the real-time updates the agent sends while processing
   * a turn: text chunks, tool calls, plan updates, etc.
   */
  private handleSessionUpdate(params: SessionNotification): void {
    const update: SessionUpdate = params.update;

    if (update.sessionUpdate === "available_commands_update") {
      this.updateSlashCommands(mapAcpSlashCommands(update.availableCommands));
      if (this.isReplayingHistory) {
        return;
      }
    }

    // Emit canonical events for chat-mode renderers. The legacy text/status
    // path below stays in place — terminal-mode threads still get all the
    // existing behaviour, and the canonical channel runs in parallel.
    //
    // During `loadSession` the agent replays persisted history as
    // `session/update` notifications. Lightcode already has those messages
    // in its own DB, so we skip canonical mapping for the replay window to
    // avoid duplicating every message in the chat pane.
    if (!this.isReplayingHistory && Date.now() >= (this.replayHistoryUntil || 0)) {
      const events = mapAcpSessionUpdate(params, this.ensureMapperState());
      if (events.length > 0) this.emitRuntimeEvents(events);
    } else {
      return;
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const content = (update as { content?: ContentBlock }).content;
        if (
          this.currentTurnInterruptRequested &&
          content?.type === "text" &&
          content.text.length > 0
        ) {
          this.recentInterruptAckTextTail = appendInterruptAckTextTail(
            this.recentInterruptAckTextTail,
            content.text,
          );
        }
      }
      // fallthrough
      case "agent_thought_chunk":
      case "user_message_chunk":
        // Agent is producing output — stay in "working" state
        break;

      case "tool_call":
        // Agent started a tool call — working state
        this.emitListenerUpdate({ status: "working", attention: "working" });
        break;

      case "tool_call_update":
        // Tool call status changed — still working
        break;

      case "plan":
        // Agent shared its plan — working state
        break;

      case "available_commands_update":
        break;

      case "current_mode_update":
        if (
          this.currentConfig &&
          "currentModeId" in update &&
          typeof update.currentModeId === "string"
        ) {
          const nextConfig = applyAcpModeUpdateToConfig(this.currentConfig, update.currentModeId);
          if (!isThreadConfigEqual(this.currentConfig, nextConfig)) {
            this.currentConfig = nextConfig;
            const sessionRef = this.currentSessionRef();
            // Mode-change confirmations are metadata, not turn boundaries —
            // preserve the live status so the renderer's working-time clock
            // doesn't reset when the agent echoes back a setSessionMode call.
            this.emitListenerUpdate({
              status: this.currentStatus,
              attention: this.currentAttention,
              config: nextConfig,
              ...(sessionRef ? { sessionRef } : {}),
            });
          }
        }
        break;

      case "config_option_update":
        if (this.currentConfig && "configOptions" in update) {
          this.rememberSessionOptions(this.availableModeIds, update.configOptions);
          const thoughtLevelConfig = findThoughtLevelConfig(update.configOptions);
          if (
            thoughtLevelConfig?.currentValue &&
            thoughtLevelConfig.currentValue !== this.currentConfig.effort
          ) {
            const nextConfig = { ...this.currentConfig, effort: thoughtLevelConfig.currentValue };
            this.currentConfig = nextConfig;
            const sessionRef = this.currentSessionRef();
            this.emitListenerUpdate({
              status: this.currentStatus,
              attention: this.currentAttention,
              config: nextConfig,
              ...(sessionRef ? { sessionRef } : {}),
            });
          }
        }
        break;

      case "session_info_update": {
        // Session metadata (title) updates are not evidence of active work.
        break;
      }

      default:
        break;
    }
  }

  private mapStopReason(stopReason: string): { status: ThreadStatus; attention: ThreadAttention } {
    switch (stopReason) {
      case "end_turn":
      case "cancelled":
        return { status: "idle", attention: "none" };
      case "max_tokens":
      case "max_turn_requests":
      case "refusal":
        return { status: "error", attention: "error" };
      default:
        return { status: "idle", attention: "none" };
    }
  }
}

function normalizeAcpElicitationResponse(
  response: unknown,
  request: CreateElicitationRequest,
): CreateElicitationResponse {
  if (!response || typeof response !== "object") return { action: "cancel" };
  const obj = response as Record<string, unknown>;
  const action = obj.action;
  const meta = readAcpResponseMeta(obj);
  if (action === "decline") return { action: "decline", ...meta };
  if (action !== "accept") return { action: "cancel", ...meta };

  const content =
    request.mode === "form"
      ? normalizeAcpElicitationContent(obj.content, request.requestedSchema.properties ?? {})
      : undefined;
  return {
    action: "accept",
    ...(content !== undefined ? { content } : {}),
    ...meta,
  };
}

function readAcpResponseMeta(
  response: Record<string, unknown>,
): { _meta: Record<string, unknown> | null } | {} {
  if (!Object.hasOwn(response, "_meta")) return {};
  const meta = response._meta;
  if (meta === null) return { _meta: null };
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return { _meta: meta as Record<string, unknown> };
}

function normalizeAcpElicitationContent(
  content: unknown,
  properties: Record<string, ElicitationPropertySchema>,
): Record<string, ElicitationContentValue> | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined;
  const source = content as Record<string, unknown>;
  const normalized: Record<string, ElicitationContentValue> = {};
  for (const [key, schema] of Object.entries(properties)) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (!schema || typeof schema !== "object" || !("type" in schema)) continue;
    switch (schema.type) {
      case "string":
        if (typeof value === "string") normalized[key] = value;
        break;
      case "integer":
      case "number":
        if (typeof value === "number" && Number.isFinite(value)) normalized[key] = value;
        break;
      case "boolean":
        if (typeof value === "boolean") normalized[key] = value;
        break;
      case "array":
        if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
          normalized[key] = value;
        }
        break;
      default:
        break;
    }
  }
  return normalized;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Decide whether `createAcpStructuredSession` should actually spawn the ACP
 * agent for this thread launch. Pulled out as a pure predicate so adapters
 * (and tests) can audit the contract without instantiating a real process.
 *
 *   - **Terminal resume** → `false`. The TUI re-attaches via its native flag
 *     (`--resume <id>`, `--session <id>`, etc.) and a parallel ACP session
 *     would just waste a process and confuse the renderer.
 *   - **GUI resume** → `true`. The structured session IS the chat surface,
 *     so it must stay live for the thread's whole lifetime; `openThread`
 *     calls `loadSession` to re-attach.
 *   - **Initial launch (any presentation)** → `true`. Even terminal threads
 *     use a short-lived ACP session to allocate the provider session id
 *     before the TUI takes over.
 */
export function shouldSpawnAcpSession(input: CreateStructuredSessionInput): boolean {
  if (input.sessionRef && input.presentationMode !== "gui") {
    return false;
  }
  return true;
}

/**
 * Create an ACP structured session for the given adapter command.
 *
 * Agent adapters call this from their `createStructuredSession()` method,
 * passing the ACP-mode command (e.g. `gemini --acp`, `copilot --acp --stdio`).
 *
 * The factory owns the resume/presentation gating via {@link shouldSpawnAcpSession}
 * so every ACP-speaking provider behaves identically. Adapters should NOT add
 * their own `if (input.sessionRef) return undefined` gate — that's what
 * produced the Copilot GUI-resume regression. Just call this factory
 * unconditionally and trust the shared decision.
 */
export function createAcpStructuredSession(
  acpCommand: CommandSpec,
  input: CreateStructuredSessionInput,
): AcpStructuredSession | undefined {
  if (!shouldSpawnAcpSession(input)) {
    return undefined;
  }
  return AcpStructuredSession.create(acpCommand, input.projectLocation, input.threadId, {
    ...(input.loadSessionErrorRewriter
      ? { loadSessionErrorRewriter: input.loadSessionErrorRewriter }
      : {}),
  });
}
