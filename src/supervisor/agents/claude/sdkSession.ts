import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import type {
  CanUseTool,
  Options as ClaudeQueryOptions,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage,
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
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
import { areAgentSlashCommandsEqual } from "@/shared/contracts";
import {
  buildAgentCommand,
  createKnownSessionRef,
  type AgentLaunchOptions,
  type CreateStructuredSessionInput,
  type StartTurnOptions,
  type StructuredSessionHandle,
  type StructuredSessionListener,
  type StructuredSessionUpdate,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { applyClaudeContextSuffix } from "./argv";
import { CLAUDE_DEFAULT_APPROVAL_POLICY } from "./detection";
import {
  ACCEPT_SUGGESTION_OPTION_PREFIX,
  closeClaudeOpenItems,
  createClaudeMapperState,
  mapClaudePermissionRequest,
  mapClaudeQuestionRequest,
  mapClaudeSdkMessage,
  nonDiagnosticErrors,
  parseClaudeQuestions,
  startClaudeTurn,
  type ClaudeMapperState,
  type ClaudeQuestion,
} from "./sdkCanonicalMapping";
import { mapClaudeSlashCommands } from "./probe";

const require = createRequire(import.meta.url);
const claudeSdkRequire = createRequire(require.resolve("@anthropic-ai/claude-agent-sdk"));

type PendingPermission = {
  kind: "permission";
  toolInput: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve: (result: PermissionResult) => void;
};

type PendingQuestion = {
  kind: "question";
  questions: ClaudeQuestion[];
  originalQuestions: unknown;
  resolve: (result: PermissionResult) => void;
};

type PendingRequest = PendingPermission | PendingQuestion;

class AsyncPromptQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value: message });
      return;
    }
    this.items.push(message);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.items.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

function projectCwd(location: ProjectLocation): string {
  switch (location.kind) {
    case "wsl":
      return location.linuxPath;
    case "windows":
    case "posix":
      return location.path;
  }
}

function permissionModeForConfig(config: ThreadConfig): PermissionMode {
  return (
    config.mode === "plan" ? "plan" : (config.approvalPolicy ?? CLAUDE_DEFAULT_APPROVAL_POLICY)
  ) as PermissionMode;
}

function filteredEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // WSL login shells should keep their own PATH; exporting Windows PATH breaks tool lookup.
    if (/^(path|pathext|systemroot|windir)$/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function spawnClaudeInWsl(location: ProjectLocation, options: SpawnOptions): SpawnedProcess {
  if (location.kind !== "wsl") {
    throw new Error("spawnClaudeInWsl called for a non-WSL project.");
  }
  const spec = buildAgentCommand(
    location,
    "claude",
    options.args,
    resolveAgentBinaryPath(location, "claude"),
    filteredEnv(options.env),
  );
  return spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: process.env,
    signal: options.signal,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as unknown as SpawnedProcess;
}

function unpackedAsarPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

function bundledClaudeExecutablePaths(): string[] {
  const binary = process.platform === "win32" ? "claude.exe" : "claude";
  if (process.platform === "linux") {
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl/${binary}`,
      `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/${binary}`,
    ];
  }
  return [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${binary}`];
}

function bundledClaudeExecutablePath(): string | undefined {
  for (const candidate of bundledClaudeExecutablePaths()) {
    try {
      return unpackedAsarPath(claudeSdkRequire.resolve(candidate));
    } catch {
      // Try the next platform package candidate.
    }
  }
  return undefined;
}

function isImageSegment(
  segment: PromptSegment,
): segment is Extract<PromptSegment, { kind: "attachment" }> {
  return (
    segment.kind === "attachment" &&
    (segment.mimeType?.startsWith("image/") === true ||
      /\.(png|jpe?g|gif|webp)$/i.test(segment.path))
  );
}

async function buildSdkUserMessage(
  prompt: string,
  segments?: PromptSegment[],
): Promise<SDKUserMessage> {
  if (!segments || segments.length === 0) {
    return {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      message: { role: "user", content: prompt },
    } as SDKUserMessage;
  }

  const content: Array<Record<string, unknown>> = [];
  const textParts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      textParts.push(segment.content);
      continue;
    }
    if (isImageSegment(segment)) {
      if (textParts.length > 0) {
        content.push({ type: "text", text: textParts.join("") });
        textParts.length = 0;
      }
      const bytes = await readFile(segment.path);
      const mimeType = segment.mimeType ?? inferImageMime(segment.path);
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: bytes.toString("base64"),
        },
      });
      continue;
    }
    textParts.push(`@${segment.path}`);
  }
  if (textParts.length > 0) content.push({ type: "text", text: textParts.join("") });
  if (content.length === 0 && prompt.length > 0) content.push({ type: "text", text: prompt });

  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content },
  } as unknown as SDKUserMessage;
}

function inferImageMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function responseOptionId(response: unknown): string | undefined {
  if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (typeof obj.optionId === "string") return obj.optionId;
    if (typeof obj.decision === "string") return obj.decision;
  }
  return undefined;
}

interface PermissionDecision {
  kind: "accept" | "acceptForSession" | "decline" | "cancel";
  /** Index into `pending.suggestions` when the user picked a single suggestion. */
  suggestionIndex?: number;
}

function permissionDecision(response: unknown): PermissionDecision {
  const option = responseOptionId(response);
  if (!option) return { kind: "accept" };

  if (option.startsWith(ACCEPT_SUGGESTION_OPTION_PREFIX)) {
    const idx = Number.parseInt(option.slice(ACCEPT_SUGGESTION_OPTION_PREFIX.length), 10);
    if (Number.isFinite(idx) && idx >= 0) {
      return { kind: "acceptForSession", suggestionIndex: idx };
    }
  }

  const lower = option.toLowerCase();
  if (lower.includes("session") || lower.includes("always")) return { kind: "acceptForSession" };
  if (lower.includes("decline") || lower.includes("deny") || lower.includes("reject")) {
    return { kind: "decline" };
  }
  if (lower.includes("cancel")) return { kind: "cancel" };
  return { kind: "accept" };
}

function questionAnswers(response: unknown, pending: PendingQuestion): Record<string, unknown> {
  if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (obj.answers && typeof obj.answers === "object") {
      return obj.answers as Record<string, unknown>;
    }
  }
  const option = responseOptionId(response);
  const first = pending.questions[0];
  return first && option ? { [first.question]: option } : {};
}

export class ClaudeSdkSession implements StructuredSessionHandle {
  launchOptions: AgentLaunchOptions = { suppressResumeConfigOverrides: true };

  private readonly input: CreateStructuredSessionInput;
  private listener: StructuredSessionListener | undefined;
  private mapperState: ClaudeMapperState;
  private promptQueue = new AsyncPromptQueue();
  private queryRuntime: Query | undefined;
  private queryReady: Promise<Query> | undefined;
  private streamStarted = false;
  private disposed = false;
  private sessionId: string | undefined;
  private currentConfig: ThreadConfig;
  private currentStatus: ThreadStatus = "idle";
  private currentAttention: ThreadAttention = "none";
  private currentSlashCommands: AgentSlashCommand[] | undefined;
  private pendingRequests = new Map<ThreadServerRequestId, PendingRequest>();
  // openThread() fires `startQuery` as a fire-and-forget IIFE and returns
  // synchronously, but the runtime calls `setListener` only afterwards from
  // `spawnThread`. Anything emitted in that window — early SDK system/stream
  // messages, or the catch-block error from a failed spawn/import — would be
  // dropped by `?.` chaining. Buffer here and drain on attach.
  private bufferedRuntimeEvents: RuntimeEvent[] = [];
  private pendingError: string | undefined;
  // Set when `interruptTurn()` runs; cleared when the next `result` arrives.
  // Lets us classify the post-interrupt result as interrupted even when
  // claude.exe emits subtype "error_during_execution" without "abort"/"interrupt"
  // in the errors array — otherwise the supervisor's drain-on-idle hook would
  // miss the steer and the staged prompt would never flush.
  private interruptInFlight = false;

  private constructor(input: CreateStructuredSessionInput) {
    this.input = input;
    this.currentConfig = input.config;
    this.mapperState = createClaudeMapperState(input.threadId);
  }

  static create(input: CreateStructuredSessionInput): Promise<ClaudeSdkSession> {
    return Promise.resolve(new ClaudeSdkSession(input));
  }

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;
    if (this.bufferedRuntimeEvents.length > 0 && listener.onRuntimeEvent) {
      const drain = this.bufferedRuntimeEvents;
      this.bufferedRuntimeEvents = [];
      for (const ev of drain) listener.onRuntimeEvent(ev);
    }
    if (this.currentSlashCommands !== undefined) {
      listener.onUpdate({
        status: this.currentStatus,
        attention: this.currentAttention,
        slashCommands: this.currentSlashCommands,
        ...(this.sessionId ? { sessionRef: createKnownSessionRef(this.sessionId) } : {}),
      });
    }
    if (this.pendingError !== undefined) {
      const message = this.pendingError;
      this.pendingError = undefined;
      listener.onError(message);
    }
  }

  private emitUpdate(update: StructuredSessionUpdate): void {
    this.currentStatus = update.status;
    this.currentAttention = update.attention;
    this.listener?.onUpdate({
      ...update,
      ...(this.currentSlashCommands !== undefined && update.slashCommands === undefined
        ? { slashCommands: this.currentSlashCommands }
        : {}),
    });
  }

  private updateSlashCommands(commands: AgentSlashCommand[]): void {
    if (areAgentSlashCommandsEqual(this.currentSlashCommands, commands)) {
      return;
    }
    this.currentSlashCommands = commands;
    this.listener?.onUpdate({
      status: this.currentStatus,
      attention: this.currentAttention,
      slashCommands: commands,
      ...(this.sessionId ? { sessionRef: createKnownSessionRef(this.sessionId) } : {}),
    });
  }

  private async refreshSlashCommands(runtime: Query): Promise<void> {
    try {
      const init = await runtime.initializationResult();
      const commands = mapClaudeSlashCommands(init.commands);
      if (commands.length > 0) {
        this.updateSlashCommands(commands);
        return;
      }
    } catch {
      // Fall back to the narrower command-list control request below.
    }

    try {
      const supported = await runtime.supportedCommands();
      const commands = mapClaudeSlashCommands(supported);
      if (commands.length > 0) {
        this.updateSlashCommands(commands);
      }
    } catch {
      // Install-time/default capabilities still provide the static fallback.
    }
  }

  async activate(): Promise<void> {
    if (this.disposed) throw new Error("ClaudeSdkSession was disposed before activation.");
  }

  async openThread(config: ThreadConfig, sessionRef?: SessionRef): Promise<string> {
    this.currentConfig = config;
    this.sessionId = sessionRef?.providerSessionId ?? randomUUID();
    this.startQuery(sessionRef?.providerSessionId);
    await this.requireQuery();
    return this.sessionId;
  }

  async startTurn(
    prompt: string,
    config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    if (this.disposed) return;
    this.currentConfig = config;
    const turnId = `turn-${randomUUID()}`;
    this.emitRuntimeEvents(
      startClaudeTurn(this.mapperState, turnId, prompt, segments, options?.userMessageItemId),
    );
    this.emitUpdate({ status: "working", attention: "working" });

    const query = await this.requireQuery();
    const model = applyClaudeContextSuffix(config.model, config.contextSize);
    try {
      await query.setModel(model);
    } catch {
      // Older SDK transports can reject live model updates; the launch model still applies.
    }
    try {
      await query.setPermissionMode(permissionModeForConfig(config));
    } catch {
      // Same best-effort rule as model updates.
    }

    this.promptQueue.push(await buildSdkUserMessage(prompt, segments));
  }

  async interruptTurn(): Promise<void> {
    this.interruptInFlight = true;
    try {
      await this.queryRuntime?.interrupt();
    } catch {
      // Best-effort; stream/result handling will settle state if the SDK already stopped.
    }
  }

  async resolveServerRequest(requestId: ThreadServerRequestId, response: unknown): Promise<void> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    this.pendingRequests.delete(requestId);

    if (pending.kind === "question") {
      pending.resolve({
        behavior: "allow",
        updatedInput: {
          questions: pending.originalQuestions,
          answers: questionAnswers(response, pending),
        },
      });
      this.emitRuntimeEvents([
        {
          type: "request.resolved",
          threadId: this.input.threadId,
          requestId: String(requestId),
          outcome: "answered",
        },
      ]);
      this.emitUpdate({ status: "working", attention: "working" });
      return;
    }

    const decision = permissionDecision(response);
    if (decision.kind === "accept" || decision.kind === "acceptForSession") {
      const pickedSuggestion =
        decision.suggestionIndex !== undefined
          ? pending.suggestions?.[decision.suggestionIndex]
          : undefined;
      const updatedPermissions: PermissionUpdate[] | undefined =
        decision.kind === "acceptForSession" && pending.suggestions
          ? pickedSuggestion
            ? [pickedSuggestion]
            : pending.suggestions
          : undefined;
      pending.resolve({
        behavior: "allow",
        updatedInput: pending.toolInput,
        ...(updatedPermissions ? { updatedPermissions } : {}),
      });
      this.emitRuntimeEvents([
        {
          type: "request.resolved",
          threadId: this.input.threadId,
          requestId: String(requestId),
          outcome: "accepted",
        },
      ]);
      this.emitUpdate({ status: "working", attention: "working" });
      return;
    }

    pending.resolve({
      behavior: "deny",
      message:
        decision.kind === "cancel"
          ? "User cancelled tool execution."
          : "User declined tool execution.",
    });
    this.emitRuntimeEvents([
      {
        type: "request.resolved",
        threadId: this.input.threadId,
        requestId: String(requestId),
        outcome: "declined",
      },
    ]);
    this.emitUpdate({ status: "working", attention: "working" });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.kind === "permission") {
        pending.resolve({ behavior: "deny", message: "Session closed." });
      } else {
        pending.resolve({ behavior: "deny", message: "Session closed." });
      }
      this.emitRuntimeEvents([
        {
          type: "request.resolved",
          threadId: this.input.threadId,
          requestId: String(requestId),
          outcome: "cancelled",
        },
      ]);
    }
    this.pendingRequests.clear();
    this.emitRuntimeEvents(closeClaudeOpenItems(this.mapperState));
    this.promptQueue.close();
    try {
      this.queryRuntime?.close();
    } catch {
      // ignore
    }
    this.listener?.onClose();
  }

  private requireQuery(): Promise<Query> {
    if (!this.queryReady) throw new Error("ClaudeSdkSession.openThread has not completed.");
    return this.queryReady;
  }

  private startQuery(resumeSessionId: string | undefined): void {
    if (this.streamStarted) return;
    this.streamStarted = true;

    this.queryReady = (async () => {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const permissionMode = permissionModeForConfig(this.currentConfig);
      const env =
        this.input.projectLocation.kind === "wsl"
          ? { CLAUDE_AGENT_SDK_CLIENT_APP: "lightcode", BROWSER: "/bin/true" }
          : { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "lightcode" };
      const claudeExecutablePath =
        this.input.projectLocation.kind === "wsl" ? undefined : bundledClaudeExecutablePath();
      const options: ClaudeQueryOptions = {
        cwd: projectCwd(this.input.projectLocation),
        model: applyClaudeContextSuffix(this.currentConfig.model, this.currentConfig.contextSize),
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["user", "project", "local"],
        permissionMode,
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        ...(resumeSessionId
          ? { resume: resumeSessionId }
          : this.sessionId
            ? { sessionId: this.sessionId }
            : {}),
        includePartialMessages: true,
        forwardSubagentText: true,
        canUseTool: this.canUseTool,
        env,
        ...(this.currentConfig.effort
          ? { effort: this.currentConfig.effort as NonNullable<ClaudeQueryOptions["effort"]> }
          : {}),
        ...(claudeExecutablePath ? { pathToClaudeCodeExecutable: claudeExecutablePath } : {}),
        ...(this.input.projectLocation.kind === "wsl"
          ? {
              spawnClaudeCodeProcess: (spawnOptions) =>
                spawnClaudeInWsl(this.input.projectLocation, spawnOptions),
            }
          : {}),
      };

      this.queryRuntime = query({ prompt: this.promptQueue, options });
      void this.refreshSlashCommands(this.queryRuntime);
      return this.queryRuntime;
    })();

    void this.queryReady
      .then(async (runtime) => {
        try {
          for await (const message of runtime) {
            if (this.disposed) break;
            this.handleSdkMessage(message);
          }
        } catch (error) {
          if (!this.disposed) {
            const message = error instanceof Error ? error.message : String(error);
            this.reportError(message);
            this.emitRuntimeEvents([{ type: "error", threadId: this.input.threadId, message }]);
          }
        }
      })
      .catch((error) => {
        if (this.disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        this.reportError(message);
        this.emitRuntimeEvents([{ type: "error", threadId: this.input.threadId, message }]);
      });
  }

  private readonly canUseTool: CanUseTool = async (toolName, toolInput, callbackOptions) => {
    if (this.disposed) return { behavior: "deny", message: "Session closed." };
    if (toolName === "AskUserQuestion") {
      const requestId = `claude-question-${randomUUID()}` as ThreadServerRequestId;
      const questions = parseClaudeQuestions(toolInput);
      return await new Promise<PermissionResult>((resolve) => {
        this.pendingRequests.set(requestId, {
          kind: "question",
          questions,
          originalQuestions: toolInput.questions,
          resolve,
        });
        callbackOptions.signal.addEventListener(
          "abort",
          () => {
            if (!this.pendingRequests.delete(requestId)) return;
            resolve({ behavior: "deny", message: "User cancelled tool execution." });
          },
          { once: true },
        );
        this.emitRuntimeEvents([
          mapClaudeQuestionRequest({
            threadId: this.input.threadId,
            requestId: String(requestId),
            questions,
          }),
        ]);
        this.emitUpdate({ status: "needs_reply", attention: "needs_reply" });
      });
    }

    const requestId = `claude-perm-${randomUUID()}` as ThreadServerRequestId;
    return await new Promise<PermissionResult>((resolve) => {
      this.pendingRequests.set(requestId, {
        kind: "permission",
        toolInput,
        ...(callbackOptions.suggestions ? { suggestions: [...callbackOptions.suggestions] } : {}),
        resolve,
      });
      callbackOptions.signal.addEventListener(
        "abort",
        () => {
          if (!this.pendingRequests.delete(requestId)) return;
          resolve({ behavior: "deny", message: "User cancelled tool execution." });
        },
        { once: true },
      );
      this.emitRuntimeEvents([
        mapClaudePermissionRequest({
          threadId: this.input.threadId,
          requestId: String(requestId),
          toolName,
          toolInput,
          ...(callbackOptions.title ? { title: callbackOptions.title } : {}),
          ...(callbackOptions.description ? { description: callbackOptions.description } : {}),
          ...(callbackOptions.displayName ? { displayName: callbackOptions.displayName } : {}),
          ...(callbackOptions.blockedPath ? { blockedPath: callbackOptions.blockedPath } : {}),
          ...(callbackOptions.decisionReason
            ? { decisionReason: callbackOptions.decisionReason }
            : {}),
          ...(callbackOptions.toolUseID ? { toolUseID: callbackOptions.toolUseID } : {}),
          ...(callbackOptions.suggestions ? { suggestions: callbackOptions.suggestions } : {}),
        }),
      ]);
      this.emitUpdate({ status: "needs_approval", attention: "needs_approval" });
    });
  };

  private handleSdkMessage(message: SDKMessage): void {
    const sessionId =
      "session_id" in message && typeof message.session_id === "string"
        ? message.session_id
        : undefined;
    if (sessionId && sessionId !== this.sessionId) {
      const previous = this.sessionId;
      this.sessionId = sessionId;
      this.emitUpdate({
        status: "working",
        attention: "working",
        sessionRef: createKnownSessionRef(sessionId),
      });
      void previous;
    }

    if (message.type === "system" && message.subtype === "session_state_changed") {
      const mapped = mapSessionState(message.state);
      this.emitUpdate(mapped);
    }

    const events = mapClaudeSdkMessage(message, this.mapperState);
    this.emitRuntimeEvents(events);
    if (message.type === "result") {
      const wasInterrupted = this.interruptInFlight || isInterruptedResult(message);
      this.interruptInFlight = false;
      const remaining = nonDiagnosticErrors(message);
      // Only diagnostic lines remained → treat as interrupted, matching
      // `mapResultState`. claude.exe emits `[ede_diagnostic] ...` whenever a
      // turn ends before the assistant produced content, including external
      // (in-CLI) Esc interrupts where `interruptInFlight` is false.
      const failed = message.subtype !== "success" && !wasInterrupted && remaining.length > 0;
      const errorMessage = failed ? remaining[0] : undefined;
      this.emitUpdate({
        status: failed ? "error" : "idle",
        attention: failed ? "error" : "none",
        ...(errorMessage ? { errorMessage } : {}),
        ...(this.sessionId ? { sessionRef: createKnownSessionRef(this.sessionId) } : {}),
      });
    }
  }

  private emitRuntimeEvents(events: RuntimeEvent[]): void {
    if (events.length === 0) return;
    if (!this.listener?.onRuntimeEvent) {
      this.bufferedRuntimeEvents.push(...events);
      return;
    }
    for (const event of events) this.listener.onRuntimeEvent(event);
  }

  private reportError(message: string): void {
    if (this.listener) {
      this.listener.onError(message);
      return;
    }
    // Surface in supervisor stderr so silent listener-not-yet-attached
    // failures still leave a trail; the message is also queued for replay
    // when `setListener` runs.
    console.error(`[claude-sdk-session] ${this.input.threadId} pre-listener error: ${message}`);
    this.pendingError = message;
  }
}

function isInterruptedResult(message: Extract<SDKMessage, { type: "result" }>): boolean {
  const filtered = nonDiagnosticErrors(message);
  // claude.exe emits an `error_during_execution` result whose only error is
  // an `[ede_diagnostic]` line when a turn was interrupted before producing
  // assistant content. Treat that as an interrupt — the SDK itself filters
  // those lines out as informational.
  if (filtered.length === 0) return true;
  const joined = filtered.join(" ").toLowerCase();
  return joined.includes("abort") || joined.includes("interrupt");
}

function mapSessionState(messageState: string): {
  status: ThreadStatus;
  attention: ThreadAttention;
} {
  switch (messageState) {
    case "running":
      return { status: "working", attention: "working" };
    case "requires_action":
      return { status: "needs_approval", attention: "needs_approval" };
    case "idle":
    default:
      return { status: "idle", attention: "none" };
  }
}
