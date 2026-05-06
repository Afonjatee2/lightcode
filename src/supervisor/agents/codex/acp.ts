import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadAttention,
  ThreadConfig,
  ThreadServerRequestId,
  ThreadStatus,
} from "@/shared/contracts";
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
  type CodexMapperState,
} from "./canonicalMapping";
import { CodexStdioTransport } from "./stdioTransport";

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

function extractThreadField(result: unknown, field: string): string | undefined {
  if (!result || typeof result !== "object" || !("thread" in result)) {
    return undefined;
  }
  const thread = (result as Record<string, unknown>).thread;
  if (!thread || typeof thread !== "object" || !(field in thread)) {
    return undefined;
  }
  const value = (thread as Record<string, unknown>)[field];
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
    const threadOverrides = {
      model: config.model,
      ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
      ...(config.sandboxMode ? { sandbox: config.sandboxMode } : {}),
      ...(config.effort ? { config: { model_reasoning_effort: config.effort } } : {}),
      ...(config.mode === "plan" ? { mode: "plan" } : {}),
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
    const threadId = await this.waitForRemoteThreadId();

    const turnId = `turn-${randomUUID()}`;
    const userItemId = options?.userMessageItemId ?? `user-${turnId}`;

    this.emitRuntimeEvents([
      {
        type: "item.started",
        threadId: this.threadId,
        itemId: userItemId,
        itemType: "user_message",
        payload: {
          content: prompt.trim().length > 0 ? [{ kind: "text" as const, text: prompt }] : [],
        },
      },
      { type: "item.completed", threadId: this.threadId, itemId: userItemId },
    ]);

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

    await this.request("turn/start", {
      threadId,
      input,
      model: config.model,
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.approvalPolicy ? { approvalPolicy: config.approvalPolicy } : {}),
      ...(config.sandboxMode ? { sandbox: config.sandboxMode } : {}),
      ...(config.mode === "plan" ? { mode: "plan" } : {}),
      ...(config.fast ? { config: { service_tier: "fast" } } : {}),
    });
  }

  async resolveServerRequest(requestId: ThreadServerRequestId, response: unknown): Promise<void> {
    this.transport.write({
      jsonrpc: "2.0",
      id: requestId,
      result: response,
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
          this.listener?.onServerRequest({
            requestId: message.id,
            method: message.method,
            params: message.params,
          });
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
          this.currentThreadStatus = params.status as CodexThreadStatus;
          this.emitDerivedUpdate();
          return;
        }

        if (method === "turn/started" && params) {
          const incomingThreadId =
            "threadId" in params ? String(params.threadId) : this.remoteThreadId;
          if (incomingThreadId && !this.isCurrentThreadNotification(incomingThreadId)) {
            return;
          }

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
    await this.request("initialize", {
      clientInfo: {
        name: "lightcode",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

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

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `lightcode-${this.requestSequence++}`;

    const pending = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}.`));
      }, 5_000);

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
