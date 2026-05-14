import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadAttention,
  ThreadConfig,
  ThreadServerRequestId,
  ThreadStatus,
  areAgentSlashCommandsEqual,
  type AgentSlashCommand,
} from "@/shared/contracts";
import { buildPromptContentBlocks } from "@/shared/promptContent";
import { terminateChildProcessTree } from "@/shared/processTree";
import { toWslUncPath } from "@/shared/wsl";
import { resolveNodeForDistro } from "../../wsl/runtime";
import {
  createKnownSessionRef,
  type AgentLaunchOptions,
  type CommandSpec,
  type CreateStructuredSessionInput,
  type StartTurnOptions,
  type StructuredSessionHandle,
  type StructuredSessionListener,
} from "../base";
import { buildCodexAppServerCommand } from "./argv";
import {
  createCodexMapperState,
  mapCodexNotification,
  mapCodexServerRequest,
  translateCodexCanonicalResponse,
  type CodexMapperState,
} from "./canonicalMapping";
import { CodexStdioTransport } from "./stdioTransport";
import { mapCodexSlashCommands, readCodexInitCommands } from "./probe";

export type CodexThreadStatus =
  | { type: "active"; activeFlags?: string[] }
  | { type: "idle" }
  | { type: "notLoaded" }
  | { type: "systemError" };

type CodexSocketMessage =
  | {
      kind: "response";
      id: string;
      result?: unknown;
      error?: unknown;
    }
  | {
      kind: "request";
      id: ThreadServerRequestId;
      method: string;
      params?: Record<string, unknown>;
    }
  | {
      kind: "notification";
      method: string;
      params?: Record<string, unknown>;
    }
  | {
      kind: "unknown";
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function spawnAppServer(command: CommandSpec): ChildProcess {
  return spawn(command.command, command.args, {
    cwd: command.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...command.env,
      TERM: "xterm-256color",
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
}

function toSessionRef(threadId: string): SessionRef {
  return createKnownSessionRef(threadId);
}

// Codex's `turn/start` requires a non-empty `developer_instructions` string
// inside `collaborationMode.settings`. We send these on every turn so that
// switching between Plan and Default mode mid-session takes effect (Codex
// would otherwise treat the prior mode as sticky).
const PLAN_MODE_DEVELOPER_INSTRUCTIONS =
  "You are operating in plan mode. Produce a clear, step-by-step plan for the user's request. Do not edit files, run shell commands, or call mutating tools — gather context with read-only tools as needed, then present the plan and wait for the user to approve before executing any changes.";

const DEFAULT_MODE_DEVELOPER_INSTRUCTIONS =
  "You are operating in default mode. Any prior plan-mode instructions no longer apply: you may edit files, run commands, and use mutating tools as appropriate to fulfill the user's request.";

// Codex `/goal` is a Codex CLI feature (experimental, gated by --enable goals).
// We mirror the TUI's sub-commands inline so the user can type them in the
// composer; the actual state lives in the Codex app-server and emits
// `thread/goal/{updated,cleared}` notifications that the canonical mapper
// surfaces as the shared goal chat item.
type CodexGoalCommand =
  | { kind: "set"; objective: string }
  | { kind: "clear" }
  | { kind: "view" }
  | { kind: "pause" }
  | { kind: "resume" };

function parseCodexGoalCommand(prompt: string): CodexGoalCommand | undefined {
  const match = /^\/goal(?:\s+([\s\S]*))?$/u.exec(prompt.trim());
  if (!match) return undefined;
  const rawArgs = match[1]?.trim() ?? "";
  if (rawArgs.length === 0) return { kind: "view" };
  if (/^(clear|reset|off|none)$/iu.test(rawArgs)) return { kind: "clear" };
  if (/^pause$/iu.test(rawArgs)) return { kind: "pause" };
  if (/^resume$/iu.test(rawArgs)) return { kind: "resume" };
  return { kind: "set", objective: rawArgs };
}

// `thread/start` accepts a SandboxMode string ("read-only" / "workspace-write" /
// "danger-full-access"), but `turn/start` accepts a SandboxPolicy *object*
// under the `sandboxPolicy` key. Sending a kebab-case string under `sandbox`
// to `turn/start` is silently dropped, so per-turn sandbox overrides — like
// switching from Supervised to Full Access mid-thread — never reach Codex.
function toCodexSandboxPolicy(
  mode: string | undefined,
): { type: "readOnly" } | { type: "workspaceWrite" } | { type: "dangerFullAccess" } | undefined {
  switch (mode) {
    case "read-only":
      return { type: "readOnly" };
    case "workspace-write":
      return { type: "workspaceWrite" };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    default:
      return undefined;
  }
}

function extractThreadField(result: unknown, field: string): string | undefined {
  return extractObjectStringField(result, "thread", field);
}

function extractTurnField(result: unknown, field: string): string | undefined {
  return extractObjectStringField(result, "turn", field);
}

function extractObjectStringField(
  result: unknown,
  objectField: string,
  field: string,
): string | undefined {
  if (!result || typeof result !== "object" || !(objectField in result)) {
    return undefined;
  }
  const object = (result as Record<string, unknown>)[objectField];
  if (!object || typeof object !== "object" || !(field in object)) {
    return undefined;
  }
  const value = (object as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

export function deriveCodexStructuredState(status: CodexThreadStatus): {
  status: ThreadStatus;
  attention: ThreadAttention;
} {
  if (status.type === "systemError") {
    return {
      status: "error",
      attention: "error",
    };
  }

  if (status.type === "idle") {
    return {
      status: "idle",
      attention: "none",
    };
  }

  if (status.type === "notLoaded") {
    return {
      status: "inactive",
      attention: "none",
    };
  }

  const activeFlags = new Set(status.activeFlags ?? []);
  if (activeFlags.has("waitingOnApproval")) {
    return {
      status: "needs_approval",
      attention: "needs_approval",
    };
  }

  if (activeFlags.has("waitingOnUserInput")) {
    return {
      status: "needs_reply",
      attention: "needs_reply",
    };
  }

  return {
    status: "working",
    attention: "working",
  };
}

export function parseCodexSocketMessage(payload: unknown): CodexSocketMessage {
  if (!payload || typeof payload !== "object") {
    return { kind: "unknown" };
  }

  const message = payload as Record<string, unknown>;
  const method = typeof message.method === "string" ? message.method : undefined;
  const params =
    typeof message.params === "object" && message.params !== null
      ? (message.params as Record<string, unknown>)
      : undefined;

  if (method) {
    if ("id" in message) {
      return {
        kind: "request",
        id: message.id as ThreadServerRequestId,
        method,
        ...(params ? { params } : {}),
      };
    }

    return {
      kind: "notification",
      method,
      ...(params ? { params } : {}),
    };
  }

  if ("id" in message) {
    return {
      kind: "response",
      id: String(message.id),
      ...("result" in message ? { result: message.result } : {}),
      ...("error" in message ? { error: message.error } : {}),
    };
  }

  return { kind: "unknown" };
}

/**
 * Pull a human-readable message out of a Codex `thread/status/changed` payload
 * when the new status is `systemError`. Codex's typed shape carries no message
 * field, but observed wire payloads sometimes include `message`, `error`, or a
 * nested `details` blob, so we probe the common spots before falling back to a
 * generic string.
 */
function extractCodexStatusErrorMessage(status: unknown): string {
  if (status && typeof status === "object") {
    const record = status as Record<string, unknown>;
    const direct = record.message ?? record.error ?? record.reason ?? record.detail;
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct;
    }
    const details = record.details;
    if (details && typeof details === "object") {
      const nested = (details as Record<string, unknown>).message;
      if (typeof nested === "string" && nested.trim().length > 0) {
        return nested;
      }
    }
  }
  return "Codex reported a system error. The session may be out of usage or otherwise unable to continue.";
}

function isRecoverableResumeError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("missing thread") ||
    lower.includes("unknown thread") ||
    lower.includes("no session") ||
    lower.includes("expired") ||
    lower.includes("invalid thread") ||
    lower.includes("session not found")
  );
}

// ── Structured Session ──────────────────────────────────────────
//
// Lifecycle for a new thread:
//   1. create()       → spawn app-server and attach stdio JSON-RPC
//   2. activate()     → initialize handshake with the server
//   3. openThread()   → thread/start on the server, get Codex thread ID
//   4. startTurn()    → fire turns through the structured server
//
// Lifecycle for resuming a saved thread:
//   1. create()       → spawn app-server and attach stdio JSON-RPC
//   2. activate()     → initialize handshake
//   3. openThread()   → thread/resume with saved session ID

// eslint-disable-next-line no-unused-vars -- planned: structured SDK session support
export class CodexStructuredSession implements StructuredSessionHandle {
  launchOptions: AgentLaunchOptions;

  private readonly appServer: ChildProcess;
  private readonly transport: CodexStdioTransport;
  private readonly threadId: string;
  private listener: StructuredSessionListener | undefined;
  private isDisposed = false;
  private activated = false;
  private requestSequence = 0;
  private remoteThreadId: string | undefined;
  private rolloutPath: string | undefined;
  private rolloutCreatedAt: string | undefined;
  private rolloutCwd: string | undefined;
  private rolloutCliVersion: string | undefined;
  private rolloutSource: Record<string, unknown> | undefined;
  private rolloutModelProvider: string | undefined;
  private wslDistro: string | undefined;
  private currentThreadStatus: CodexThreadStatus = { type: "idle" };
  private activeTurnId: string | undefined;
  private currentSlashCommands: AgentSlashCommand[] | undefined;
  private pendingTurnInterrupt = false;
  // Sticky-error gate: once a turn fails, derived status updates from
  // `thread/status/changed` (which Codex emits as `idle` after an aborted
  // turn) must not overwrite the error state. Cleared on the next user turn.
  private errorSticky = false;
  private mapperState: CodexMapperState | undefined;
  /**
   * Runtime events emitted before the listener was wired. Replayed on
   * `setListener` — same race as `AcpStructuredSession`.
   */
  private bufferedRuntimeEvents: RuntimeEvent[] = [];
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  /**
   * Inbound JSON-RPC requests the app-server is waiting on us to answer.
   * The canonical request panel resolves with `{ optionId }`; we need the
   * original method + params to translate that back into the Codex-native
   * result shape in {@link resolveServerRequest}.
   */
  private readonly inboundRequests = new Map<
    string,
    { method: string; params: Record<string, unknown> | undefined }
  >();

  private constructor(
    appServer: ChildProcess,
    transport: CodexStdioTransport,
    threadId: string,
    wslDistro?: string,
  ) {
    this.appServer = appServer;
    this.transport = transport;
    this.threadId = threadId;
    this.wslDistro = wslDistro;
    this.launchOptions = {
      suppressResumeConfigOverrides: true,
    };
  }

  private ensureMapperState(): CodexMapperState {
    if (!this.mapperState) {
      this.mapperState = createCodexMapperState(this.threadId);
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

  private async dispatchCodexGoalCommand(
    threadId: string,
    command: CodexGoalCommand,
  ): Promise<void> {
    switch (command.kind) {
      case "set":
        await this.request("thread/goal/set", {
          threadId,
          objective: command.objective,
          status: "active",
        });
        return;
      case "clear":
        await this.request("thread/goal/clear", { threadId });
        return;
      case "pause":
        await this.request("thread/goal/set", { threadId, status: "paused" });
        return;
      case "resume":
        await this.request("thread/goal/set", { threadId, status: "active" });
        return;
      case "view":
        // The active goal item is already in the chat via `thread/goal/updated`
        // notifications. `/goal` alone is acknowledged with the user_message
        // and a settled idle status — no RPC is required.
        return;
    }
  }

  private updateSlashCommands(commands: AgentSlashCommand[]): void {
    if (areAgentSlashCommandsEqual(this.currentSlashCommands, commands)) {
      return;
    }
    this.currentSlashCommands = commands;
    this.listener?.onUpdate({
      ...deriveCodexStructuredState(this.currentThreadStatus),
      ...(this.remoteThreadId ? { sessionRef: toSessionRef(this.remoteThreadId) } : {}),
      slashCommands: commands,
    });
  }

  static async create(
    input: CreateStructuredSessionInput,
    wslExecPath?: string,
  ): Promise<CodexStructuredSession> {
    const wslNodePath =
      input.projectLocation.kind === "wsl"
        ? (await resolveNodeForDistro(input.projectLocation.distro)).nodePath
        : undefined;
    const appServer = spawnAppServer(
      buildCodexAppServerCommand(input.projectLocation, wslExecPath, wslNodePath),
    );
    const transport = new CodexStdioTransport(appServer);

    const spawnError = await new Promise<Error | undefined>((resolve) => {
      appServer.once("error", (error) => resolve(error));
      setImmediate(() => resolve(undefined));
    });
    if (spawnError) {
      throw new Error(`Codex app-server failed to spawn: ${spawnError.message}`);
    }
    if (appServer.exitCode !== null) {
      throw new Error(`Codex app-server exited early.${transport.formatOutput()}`);
    }

    const wslDistro =
      input.projectLocation.kind === "wsl" ? input.projectLocation.distro : undefined;
    const session = new CodexStructuredSession(appServer, transport, input.threadId, wslDistro);
    session.attachTransportHandlers();

    return session;
  }

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;

    // Drain runtime events that arrived before the listener was wired.
    if (listener.onRuntimeEvent && this.bufferedRuntimeEvents.length > 0) {
      const drained = this.bufferedRuntimeEvents;
      this.bufferedRuntimeEvents = [];
      for (const event of drained) {
        listener.onRuntimeEvent(event);
      }
    }

    // Re-emit current state so the listener doesn't miss updates that
    // fired before the listener was attached.
    if (this.activated && this.remoteThreadId) {
      const sessionRef = toSessionRef(this.remoteThreadId);
      listener.onUpdate({
        ...deriveCodexStructuredState(this.currentThreadStatus),
        sessionRef,
        ...(this.currentSlashCommands !== undefined
          ? { slashCommands: this.currentSlashCommands }
          : {}),
      });
    } else if (this.currentSlashCommands !== undefined) {
      listener.onUpdate({
        ...deriveCodexStructuredState(this.currentThreadStatus),
        slashCommands: this.currentSlashCommands,
      });
    }
  }

  async activate(): Promise<void> {
    if (this.activated) {
      throw new Error("CodexStructuredSession already activated.");
    }
    if (this.isDisposed) {
      throw new Error("CodexStructuredSession was disposed before activation.");
    }
    this.activated = true;

    await this.initialize();
  }

  async openThread(config: ThreadConfig, sessionRef?: SessionRef): Promise<string> {
    // `mode` does not exist on `thread/start` or `thread/resume`; plan mode is
    // a per-turn override sent via `collaborationMode` on `turn/start`.
    const threadOverrides = {
      model: config.model,
      ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
      ...(config.sandboxMode ? { sandbox: config.sandboxMode } : {}),
      config: {
        ...(config.effort ? { model_reasoning_effort: config.effort } : {}),
        model_reasoning_summary: "auto",
      },
    };

    const startParams = {
      ...threadOverrides,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    };

    let threadId: string;

    if (sessionRef) {
      try {
        await this.request("thread/resume", {
          ...threadOverrides,
          threadId: sessionRef.providerSessionId,
          persistExtendedHistory: true,
        });
        threadId = sessionRef.providerSessionId;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!isRecoverableResumeError(msg)) {
          throw error;
        }
        console.log("[codex] thread/resume failed (%s), falling back to thread/start", msg);
        const result = await this.request("thread/start", startParams);
        threadId = extractThreadField(result, "id") ?? "";
        if (!threadId) {
          throw new Error("thread/start fallback response did not contain a thread id.", {
            cause: error,
          });
        }
        this.extractRolloutMeta(result);
      }
    } else {
      const result = await this.request("thread/start", startParams);
      threadId = extractThreadField(result, "id") ?? "";
      if (!threadId) {
        throw new Error("thread/start response did not contain a thread id.");
      }
      this.extractRolloutMeta(result);
    }

    this.remoteThreadId = threadId;
    this.launchOptions = { ...this.launchOptions, resumeThreadId: threadId };

    return threadId;
  }

  private extractRolloutMeta(result: unknown): void {
    const thread =
      result && typeof result === "object" && "thread" in result
        ? ((result as Record<string, unknown>).thread as Record<string, unknown> | undefined)
        : undefined;
    const rawPath = extractThreadField(result, "path") ?? undefined;
    this.rolloutPath = rawPath && this.wslDistro ? toWslUncPath(this.wslDistro, rawPath) : rawPath;
    this.rolloutCreatedAt =
      thread && typeof thread.createdAt === "number"
        ? new Date(thread.createdAt * 1000).toISOString()
        : new Date().toISOString();
    this.rolloutCwd = typeof thread?.cwd === "string" ? thread.cwd : undefined;
    this.rolloutCliVersion = typeof thread?.cliVersion === "string" ? thread.cliVersion : undefined;
    this.rolloutSource =
      thread && typeof thread.source === "object" && thread.source !== null
        ? (thread.source as Record<string, unknown>)
        : undefined;
    this.rolloutModelProvider =
      typeof thread?.modelProvider === "string" ? thread.modelProvider : undefined;
  }

  async waitForRolloutFile(timeoutMs = 10_000): Promise<void> {
    if (!this.rolloutPath) {
      return;
    }
    const { existsSync } = await import("node:fs");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(this.rolloutPath)) {
        return;
      }
      await sleep(200);
    }
  }

  async ensureResumeArtifacts(): Promise<void> {
    if (!this.rolloutPath || !this.remoteThreadId) {
      return;
    }

    const { existsSync } = await import("node:fs");
    if (existsSync(this.rolloutPath)) {
      return;
    }

    await mkdir(dirname(this.rolloutPath), { recursive: true });

    const sessionMeta = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "session_meta",
      payload: {
        id: this.remoteThreadId,
        ...(this.rolloutCreatedAt ? { timestamp: this.rolloutCreatedAt } : {}),
        ...(this.rolloutCwd ? { cwd: this.rolloutCwd } : {}),
        originator: "lightcode",
        ...(this.rolloutCliVersion ? { cli_version: this.rolloutCliVersion } : {}),
        ...(this.rolloutSource ? { source: this.rolloutSource } : {}),
        ...(this.rolloutModelProvider ? { model_provider: this.rolloutModelProvider } : {}),
      },
    });

    try {
      await writeFile(this.rolloutPath, `${sessionMeta}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  async startTurn(
    prompt: string,
    config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    // New user turn clears any sticky error from a previous failed turn.
    this.errorSticky = false;
    const threadId = await this.waitForRemoteThreadId();

    const turnId = `turn-${randomUUID()}`;
    const userItemId = options?.userMessageItemId ?? `user-${turnId}`;
    const goalCommand = parseCodexGoalCommand(prompt);

    const userEvents: RuntimeEvent[] = [
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
    ];

    if (goalCommand) {
      this.emitRuntimeEvents([
        { type: "turn.started", threadId: this.threadId, turnId },
        ...userEvents,
      ]);
      try {
        await this.dispatchCodexGoalCommand(threadId, goalCommand);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emitRuntimeEvents([
          { type: "error", threadId: this.threadId, message },
          { type: "turn.completed", threadId: this.threadId, turnId, state: "completed" },
        ]);
        this.listener?.onUpdate({ status: "idle", attention: "none" });
        return;
      }
      this.emitRuntimeEvents([
        { type: "turn.completed", threadId: this.threadId, turnId, state: "completed" },
      ]);
      this.listener?.onUpdate({ status: "idle", attention: "none" });
      return;
    }

    this.emitRuntimeEvents(userEvents);

    this.listener?.onUpdate({ status: "working", attention: "working" });

    // Build structured input using native Codex protocol types:
    //   - "localImage" for image attachments (path-based)
    //   - "mention"    for file reference segments (@-mentions)
    //   - "text"       for the prompt text
    const input: Record<string, unknown>[] = [];

    for (const seg of segments ?? []) {
      if (seg.kind === "attachment") {
        const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(seg.path);
        if (isImage) {
          input.push({ type: "localImage", path: seg.path });
        } else {
          input.push({
            type: "mention",
            path: seg.path,
            name: seg.path.split(/[\\/]/).pop() ?? seg.path,
          });
        }
      } else if (seg.kind === "file") {
        input.push({
          type: "mention",
          path: seg.path,
          name: seg.path.split(/[\\/]/).pop() ?? seg.path,
        });
      }
    }

    input.push({ type: "text", text: prompt, text_elements: [] });

    const sandboxPolicy = toCodexSandboxPolicy(config.sandboxMode);
    // Plan mode is sticky at the session level once set, so always send the
    // current mode on every turn — otherwise toggling Plan off won't revert.
    // `collaborationMode.settings` is a *required* field and its three
    // string members (model / reasoning_effort / developer_instructions)
    // reject `null`s and empty objects — Codex's JSON-RPC validator wants
    // real strings on every turn.
    const collaborationMode = {
      mode: config.mode === "plan" ? "plan" : "default",
      settings: {
        model: config.model,
        reasoning_effort: config.effort ?? "medium",
        developer_instructions:
          config.mode === "plan"
            ? PLAN_MODE_DEVELOPER_INSTRUCTIONS
            : DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      },
    };
    try {
      const result = await this.request("turn/start", {
        threadId,
        input,
        model: config.model,
        ...(config.effort ? { effort: config.effort } : {}),
        summary: "auto",
        ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
        ...(sandboxPolicy ? { sandboxPolicy } : {}),
        collaborationMode,
        ...(config.fast ? { serviceTier: "fast" } : {}),
      });
      this.activeTurnId = extractTurnField(result, "id");
      if (this.pendingTurnInterrupt && this.activeTurnId) {
        this.pendingTurnInterrupt = false;
        await this.request("turn/interrupt", {
          threadId,
          turnId: this.activeTurnId,
        });
      }
    } catch (error) {
      if (this.isDisposed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.errorSticky = true;
      this.listener?.onUpdate({ status: "error", attention: "error", errorMessage: message });
      this.emitRuntimeEvents([{ type: "error", threadId: this.threadId, message }]);
      throw error;
    }
  }

  async interruptTurn(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    const threadId = await this.waitForRemoteThreadId();
    if (!this.activeTurnId) {
      this.pendingTurnInterrupt = true;
      return;
    }

    await this.request("turn/interrupt", {
      threadId,
      turnId: this.activeTurnId,
    });
  }

  async resolveServerRequest(requestId: ThreadServerRequestId, response: unknown): Promise<void> {
    const inbound = this.inboundRequests.get(String(requestId));
    this.inboundRequests.delete(String(requestId));
    const result = inbound
      ? translateCodexCanonicalResponse(inbound.method, inbound.params, response)
      : response;
    this.transport.write({
      jsonrpc: "2.0",
      id: requestId,
      result,
    });
  }

  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.transport.dispose();

    this.rejectPendingRequests(new Error("Codex app-server session disposed."));

    if (!this.appServer.killed) {
      terminateChildProcessTree(this.appServer);
    }
  }

  private attachTransportHandlers(): void {
    this.transport.setListener({
      onMessage: (payload) => {
        const message = parseCodexSocketMessage(payload);

        if (message.kind === "response") {
          const pending = this.pendingRequests.get(message.id);
          if (!pending) {
            return;
          }

          this.pendingRequests.delete(message.id);
          clearTimeout(pending.timeout);

          if (message.error !== undefined) {
            const err = message.error;
            const errMsg =
              typeof err === "object" && err !== null && "message" in err
                ? String((err as Record<string, unknown>).message)
                : String(err);
            pending.reject(new Error(errMsg));
          } else {
            pending.resolve(message.result);
          }
          return;
        }

        if (message.kind === "request") {
          this.inboundRequests.set(String(message.id), {
            method: message.method,
            params: message.params,
          });
          const canonical = mapCodexServerRequest(
            this.threadId,
            String(message.id),
            message.method,
            message.params,
          );
          if (canonical) {
            this.emitRuntimeEvents([canonical]);
          } else {
            console.warn(
              `[codex] no canonical mapping for app-server request method "${message.method}"; the agent will block until the request is answered.`,
            );
          }
          return;
        }

        if (message.kind !== "notification") {
          return;
        }

        const { method, params } = message;

        // Translate to canonical chat events for chat-mode renderers. Runs
        // alongside the existing status-derivation logic below — terminal mode
        // is unaffected.
        const runtimeEvents = mapCodexNotification(method, params, this.ensureMapperState());
        if (runtimeEvents.length > 0) this.emitRuntimeEvents(runtimeEvents);

        if (method === "thread/started" && params && "thread" in params) {
          const thread = params.thread;
          if (!thread || typeof thread !== "object" || !("id" in thread)) {
            return;
          }

          const threadId = String(thread.id);

          // Ignore thread/started for threads we didn't create (e.g. the TUI's own thread).
          if (this.remoteThreadId !== undefined && this.remoteThreadId !== threadId) {
            return;
          }

          this.remoteThreadId = threadId;
          const nextSessionRef = toSessionRef(threadId);
          this.currentThreadStatus =
            "status" in thread && thread.status && typeof thread.status === "object"
              ? (thread.status as CodexThreadStatus)
              : { type: "idle" };
          this.emitDerivedUpdate(nextSessionRef);
          void this.syncRemoteThreadState(threadId, nextSessionRef);
          return;
        }

        if (
          method === "thread/status/changed" &&
          params &&
          "threadId" in params &&
          "status" in params
        ) {
          if (!this.isCurrentThreadNotification(String(params.threadId))) {
            return;
          }
          const nextStatus = params.status as CodexThreadStatus;
          // A systemError status alone gives the renderer a red icon but no
          // message. If Codex didn't already send a paired `thread/error`
          // notification or a turn/start rejection (which set `errorSticky`),
          // surface a fallback runtime error event so `ThreadErrorDock`
          // renders something instead of leaving the user with an empty dock.
          // Set `errorSticky` *after* `emitDerivedUpdate` so the derived
          // `onUpdate` call still fires — `emitDerivedUpdate` short-circuits
          // when `errorSticky` is already true.
          const shouldFallbackEmit =
            nextStatus.type === "systemError" &&
            this.currentThreadStatus.type !== "systemError" &&
            !this.errorSticky;
          if (shouldFallbackEmit) {
            const fallbackMessage = extractCodexStatusErrorMessage(params.status);
            this.emitRuntimeEvents([
              { type: "error", threadId: this.threadId, message: fallbackMessage },
            ]);
          }
          this.currentThreadStatus = nextStatus;
          this.emitDerivedUpdate();
          if (shouldFallbackEmit) {
            this.errorSticky = true;
          }
          return;
        }

        if (method === "turn/started" && params) {
          const incomingThreadId =
            "threadId" in params ? String(params.threadId) : this.remoteThreadId;
          if (incomingThreadId && !this.isCurrentThreadNotification(incomingThreadId)) {
            return;
          }

          this.activeTurnId =
            extractTurnField(params, "id") ??
            (typeof params.turnId === "string" ? params.turnId : this.activeTurnId);
          this.listener?.onUpdate({
            status: "working",
            attention: "working",
          });
          return;
        }

        if ((method === "turn/completed" || method === "turn/aborted") && params) {
          const incomingThreadId =
            "threadId" in params ? String(params.threadId) : this.remoteThreadId;
          if (!incomingThreadId) return;
          if (!this.isCurrentThreadNotification(incomingThreadId)) {
            return;
          }

          this.pendingTurnInterrupt = false;
          this.activeTurnId = undefined;
          void this.syncRemoteThreadState(incomingThreadId);
          return;
        }

        if (method === "account/rateLimits/updated" && params && "rateLimits" in params) {
          return;
        }

        if (method === "thread/closed") {
          this.listener?.onClose();
        }
      },
      onClose: () => {
        this.rejectPendingRequests(
          new Error(`Codex app-server exited.${this.transport.formatOutput()}`),
        );
        if (!this.isDisposed) {
          this.listener?.onClose();
        }
      },
      onError: (error) => {
        this.rejectPendingRequests(error);
        if (!this.isDisposed) {
          this.listener?.onError("Codex app-server connection failed.");
        }
      },
    });
  }

  private async initialize(): Promise<void> {
    // Cold start runs through an interactive login shell + Rust binary load +
    // first-launch Gatekeeper checks on macOS, which can exceed the default
    // 5s timeout. The probe path uses 12s for the same handshake.
    const initResult = await this.request(
      "initialize",
      {
        clientInfo: {
          name: "lightcode",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      },
      30_000,
    );

    const commands = mapCodexSlashCommands(readCodexInitCommands(initResult));
    if (commands.length > 0) {
      this.updateSlashCommands(commands);
    }

    this.transport.write({
      jsonrpc: "2.0",
      method: "initialized",
    });
  }

  private isCurrentThreadNotification(threadId: string): boolean {
    return this.remoteThreadId === undefined || this.remoteThreadId === threadId;
  }

  private async waitForRemoteThreadId(): Promise<string> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (this.remoteThreadId) {
        return this.remoteThreadId;
      }
      await sleep(50);
    }

    throw new Error("Codex remote thread is not ready yet.");
  }

  private emitDerivedUpdate(sessionRef?: SessionRef): void {
    if (this.errorSticky) {
      // Preserve error status until the user starts a new turn. Still forward
      // sessionRef updates if present so resume metadata is not lost.
      if (sessionRef) {
        this.listener?.onUpdate({ status: "error", attention: "error", sessionRef });
      }
      return;
    }
    const next = deriveCodexStructuredState(this.currentThreadStatus);
    this.listener?.onUpdate({
      status: next.status,
      attention: next.attention,
      ...(sessionRef ? { sessionRef } : {}),
    });
  }

  private async syncRemoteThreadState(threadId: string, sessionRef?: SessionRef): Promise<void> {
    try {
      const result = await this.request("thread/read", {
        threadId,
        includeTurns: false,
      });

      if (!result || typeof result !== "object" || !("thread" in result)) {
        return;
      }

      const thread = result.thread;
      if (!thread || typeof thread !== "object") {
        return;
      }

      if ("status" in thread && thread.status && typeof thread.status === "object") {
        this.currentThreadStatus = thread.status as CodexThreadStatus;
      }
      this.emitDerivedUpdate(sessionRef);
    } catch {
      // Ignore best-effort sync failures and continue using notifications.
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 5_000,
  ): Promise<unknown> {
    const id = `lightcode-${this.requestSequence++}`;

    const pending = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}.`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
      });
    });

    this.transport.write({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    return pending;
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
