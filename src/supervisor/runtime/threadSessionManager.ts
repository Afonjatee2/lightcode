import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn, type IPty } from "node-pty";
import type { SupervisorEvent } from "@/shared/ipc";
import { defaultSharedSettings, normalizeSharedSettings } from "@/shared/settings";
import {
  type AgentKind,
  type ClearPendingSteerPayload,
  type CloseThreadPayload,
  type PendingSteerState,
  type PromptSegment,
  type ProjectLocation,
  type ResizeTerminalPayload,
  type ResolveThreadServerRequestPayload,
  type SendThreadInputPayload,
  type SessionRef,
  type SetPendingSteerPayload,
  type StartShellPayload,
  type StartThreadPayload,
  type StartThreadResult,
  type TerminalSize,
  type ThreadConfig,
  type ThreadRuntimeSnapshot,
  type WriteTerminalPayload,
  type RuntimeEvent,
  isThreadConfigEqual,
} from "@/shared/contracts";
import { buildPromptContentBlocks } from "@/shared/promptContent";
import { terminateProcessTree } from "@/shared/processTree";
import {
  type AgentAdapter,
  type CommandSpec,
  type StructuredSessionHandle,
  createKnownSessionRef,
  defaultFormatPromptSegments,
  getWslCommand,
  injectWslEnv,
  resolveLaunchSpec,
} from "../agents/base";
import type { WindowsShellPreference } from "../shellPreference";
import { BufferedLogWriter } from "./bufferedLogWriter";
import { hookDebugSpawn } from "./hookDebug";
import type {
  PendingSteerSlot,
  QueuedStructuredTurn,
  SessionRuntime,
  ShellSessionRuntime,
} from "./sessionTypes";
import { ThreadOutputPipeline, resolveThreadStatusSource } from "./threadOutputPipeline";
import { rewriteSegmentsForWsl } from "./threadAttachments";

function hookDebugProjectLabel(loc: ProjectLocation): string {
  switch (loc.kind) {
    case "wsl":
      return `wsl:${loc.distro}`;
    case "windows":
      return `windows:${loc.path}`;
    case "posix":
      return `posix:${loc.path}`;
  }
}

export async function writeSubmittedPrompt(
  pty: Pick<IPty, "write">,
  chunks: readonly string[],
  _projectLocation: ProjectLocation,
): Promise<void> {
  for (const chunk of chunks) {
    const waitMatch = chunk.match(/^@wait:(\d+)$/);
    if (waitMatch) {
      await sleep(Number(waitMatch[1]));
      continue;
    }
    pty.write(chunk);
    await sleep(8);
  }
}

/**
 * Grace window before the local fallback commits to `idle` after detecting a
 * user-interrupt keystroke. Long enough for a legitimate
 * `PostToolUseFailure { is_interrupt: true }` hook to land and take over,
 * short enough that the UI doesn't feel stuck.
 */
export const USER_INTERRUPT_RECOVERY_GRACE_MS = 1200;
const RUNTIME_EVENT_BATCH_MS = 16;

/**
 * True iff the user keystroke payload represents an interrupt intent the
 * user expects to unblock the agent. Matches:
 *   - `\x03`   (Ctrl+C)     — always an interrupt
 *   - exactly `\x1b` (Esc)  — standalone Esc press
 * Does NOT match CSI sequences like `\x1b[A` (arrows) or `\x1bO...` (fn keys),
 * or alt+<char> (`\x1b<letter>`), so menu navigation inside the permission
 * dialog does not trigger the fallback.
 */
export function isUserInterruptKeystroke(data: string): boolean {
  if (data.includes("\x03")) return true;
  if (data === "\x1b") return true;
  return false;
}

/**
 * True iff the current thread status is "busy" from the user's point of view —
 * i.e. pressing Esc / Ctrl+C in this state is expected to unblock the UI.
 */
function isInterruptibleBusyStatus(status: SessionRuntime["status"]): boolean {
  return status === "working" || status === "needs_approval" || status === "needs_reply";
}

function requireSessionPty(session: SessionRuntime): IPty {
  if (!session.pty) {
    throw new Error(`Thread ${session.threadId} does not have a terminal PTY.`);
  }
  return session.pty;
}

function getClaudeL2TerminalEnv(input: {
  agentKind: AgentKind;
  projectLocation: ProjectLocation;
  disableCliHookPlugin: boolean;
  cliHookEnvInjected: boolean;
}): Record<string, string> {
  if (input.agentKind !== "claude") {
    return {};
  }
  if (!input.disableCliHookPlugin && input.cliHookEnvInjected) {
    return {};
  }
  return {
    TERM_PROGRAM: "iTerm.app",
    TERM_PROGRAM_VERSION: "3.6.6",
  };
}

export interface ThreadSessionManagerOptions {
  emit(event: SupervisorEvent): void;
  isDev: boolean;
  logsDir: string;
  settingsPath: string;
  readDisableCliHookPlugin(): boolean;
  adapters: Map<AgentKind, AgentAdapter>;
  windowsShell: WindowsShellPreference;
  /**
   * Optional: provides CLI hook plugin ingress env vars + extra CLI args injected
   * into every agent PTY spawn. The supervisor boots a single
   * `HookIngress` and exposes this hook so the manager doesn't depend on
   * `node:http` itself.
   */
  resolvePluginEnvForSpawn?(input: {
    threadId: string;
    agentKind: AgentKind;
    projectLocation: ProjectLocation;
  }): Promise<{ env: Record<string, string>; extraArgs: string[] } | undefined>;
}

export class ThreadSessionManager {
  readonly sessions = new Map<string, SessionRuntime>();
  readonly shellSessions = new Map<string, ShellSessionRuntime>();
  /** Reverse index: agent-native session id → SessionRuntime, for CLI hook routing fallback. */
  readonly sessionsBySessionId = new Map<string, SessionRuntime>();
  private readonly startLocks = new Map<string, Promise<void>>();
  private readonly logWriter = new BufferedLogWriter();
  private readonly outputPipeline: ThreadOutputPipeline;
  private readonly pendingRuntimeEvents = new Map<string, RuntimeEvent[]>();
  private runtimeEventBatchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ThreadSessionManagerOptions) {
    this.outputPipeline = new ThreadOutputPipeline({
      emit: options.emit,
      isDev: options.isDev,
      logWriter: this.logWriter,
      resolveLogPath: (threadId) => this.resolveLogPath(threadId),
      resolveHintLogPath: (threadId) => this.resolveHintLogPath(threadId),
      readDisableCliHookPlugin: this.options.readDisableCliHookPlugin,
      onRecoverInvalidSessionRef: (session) => this.recoverInvalidSessionRef(session),
      onStartQueuedLaunchPrompt: (session) => this.startQueuedLaunchPrompt(session),
      onStartSessionRefDiscovery: (session) => this.pollSessionRefDiscovery(session),
    });
  }

  private readDisableCliHookPlugin(): boolean {
    return this.options.readDisableCliHookPlugin();
  }

  getThreadSnapshots(): ThreadRuntimeSnapshot[] {
    return [...this.sessions.values()].map((session) => ({
      threadId: session.threadId,
      status: session.status,
      attention: session.attention,
      config: session.config,
      ...(session.sessionRef ? { sessionRef: session.sessionRef } : {}),
      canResumeWithConfig: session.canResumeWithConfig,
      threadStatusSource: resolveThreadStatusSource(session, this.readDisableCliHookPlugin()),
    }));
  }

  /**
   * Surface a structured-session failure on both axes: status (so the icon
   * goes red) and a runtime `error` event (so `ThreadErrorDock` and the chat
   * stream actually render the message). The supervisor stores `errorMessage`
   * on the thread state, but no renderer surface reads `thread.errorMessage`
   * — only the runtime error item drives `ThreadErrorDock` — so without the
   * event the user sees a red icon and nothing else.
   */
  private failStructuredSession(session: SessionRuntime, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.outputPipeline.updateState(session, "error", "error", message);
    this.enqueueRuntimeEvent(session.threadId, {
      type: "error",
      threadId: session.threadId,
      message,
    });
  }

  private enqueueRuntimeEvent(threadId: string, event: RuntimeEvent): void {
    const pending = this.pendingRuntimeEvents.get(threadId);
    if (pending) {
      pending.push(event);
    } else {
      this.pendingRuntimeEvents.set(threadId, [event]);
    }
    this.runtimeEventBatchTimer ??= setTimeout(() => {
      this.flushRuntimeEvents();
    }, RUNTIME_EVENT_BATCH_MS);
  }

  private flushRuntimeEvents(): void {
    if (this.runtimeEventBatchTimer) {
      clearTimeout(this.runtimeEventBatchTimer);
      this.runtimeEventBatchTimer = undefined;
    }
    if (this.pendingRuntimeEvents.size === 0) return;

    // Single-thread path: keep the existing per-thread IPC shape so single
    // active stream cases stay on the cheaper non-array envelope.
    if (this.pendingRuntimeEvents.size === 1) {
      for (const [threadId, events] of this.pendingRuntimeEvents) {
        if (events.length === 1) {
          this.options.emit({ type: "thread-runtime-event", threadId, event: events[0]! });
        } else if (events.length > 1) {
          this.options.emit({ type: "thread-runtime-events", threadId, events: [...events] });
        }
      }
      this.pendingRuntimeEvents.clear();
      return;
    }

    // Multi-thread path: collapse into a single IPC envelope so 6-8 concurrent
    // streams produce one round-trip per 16ms tick instead of 6-8.
    const batches: { threadId: string; events: RuntimeEvent[] }[] = [];
    for (const [threadId, events] of this.pendingRuntimeEvents) {
      if (events.length > 0) batches.push({ threadId, events: [...events] });
    }
    if (batches.length > 0) {
      this.options.emit({ type: "thread-runtime-events-multi", batches });
    }
    this.pendingRuntimeEvents.clear();
  }

  /**
   * Look up the live `SessionRuntime` for a CLI hook plugin envelope. Routing
   * precedence is `threadId` (PTY env, primary) → `sessionId`
   * (`providerSessionId` discovered after spawn, fallback for nested shells).
   */
  findSessionForCliHookPlugin(input: {
    threadId?: string;
    sessionId?: string;
  }): SessionRuntime | undefined {
    if (input.threadId) {
      const direct = this.sessions.get(input.threadId);
      if (direct) return direct;
    }
    if (input.sessionId) {
      const indexed = this.sessionsBySessionId.get(input.sessionId);
      if (indexed) return indexed;
      // Fallback: scan for late-arriving `sessionRef`s that haven't been
      // indexed yet (race between hook SessionStart and provider sessionRef
      // discovery). Sessions count is small; linear scan is fine.
      for (const session of this.sessions.values()) {
        if (session.sessionRef?.providerSessionId === input.sessionId) {
          this.sessionsBySessionId.set(input.sessionId, session);
          return session;
        }
      }
    }
    return undefined;
  }

  /** Apply a CLI hook plugin state change resolved by the dispatcher. */
  applyCliHookPluginState(
    session: SessionRuntime,
    change: {
      status: import("@/shared/contracts").ThreadStatus;
      attention: import("@/shared/contracts").ThreadAttention;
    },
  ): void {
    this.outputPipeline.applyCliHookPluginState(session, change);
  }

  /**
   * Update the `sessionsBySessionId` index when a session's `sessionRef`
   * changes. Idempotent — clears any stale id mapping before writing the new
   * one. Call from anywhere that mutates `session.sessionRef`.
   */
  private indexSessionRef(session: SessionRuntime, prevId: string | undefined): void {
    if (prevId && this.sessionsBySessionId.get(prevId) === session) {
      this.sessionsBySessionId.delete(prevId);
    }
    const nextId = session.sessionRef?.providerSessionId;
    if (nextId) {
      this.sessionsBySessionId.set(nextId, session);
    }
  }

  async startThread(payload: StartThreadPayload): Promise<StartThreadResult> {
    const threadId = payload.threadId ?? randomUUID();
    const pending = this.startLocks.get(threadId);
    if (pending) {
      return { threadId };
    }

    const run = this.startThreadInner({ ...payload, threadId });
    this.startLocks.set(
      threadId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await run;
    } finally {
      this.startLocks.delete(threadId);
    }
  }

  async sendThreadInput(payload: SendThreadInputPayload): Promise<void> {
    const session = this.requireSession(payload.threadId);
    if (session.status === "inactive") {
      if (session.sessionRef) {
        await this.restartThread(session, payload.prompt, payload.config);
        return;
      }
      throw new Error("This thread exited before a resumable session id was discovered.");
    }

    const usesStructuredFlow =
      session.adapter.capabilities.liveInputMode === "server" || session.presentationMode === "gui";
    const effectiveSegments = payload.segments
      ? rewriteSegmentsForWsl(payload.segments, session.projectLocation, {
          preserveImageAttachments: usesStructuredFlow,
        })
      : undefined;
    const prompt =
      effectiveSegments && effectiveSegments.length > 0
        ? (session.adapter.formatPromptSegments?.(effectiveSegments) ??
          defaultFormatPromptSegments(effectiveSegments))
        : payload.prompt;

    const effectiveConfig =
      session.presentationMode !== "gui" &&
      payload.config.mode === "plan" &&
      session.config.mode === undefined
        ? { ...payload.config, mode: undefined }
        : payload.config;

    session.config = effectiveConfig;
    // Route through the structured session when either the adapter is
    // server-controlled OR this thread was launched in chat mode (the
    // structured session owns input/output instead of the PTY).
    if (usesStructuredFlow && session.structuredSession?.startTurn) {
      const turn: QueuedStructuredTurn = {
        prompt,
        config: effectiveConfig,
        ...(effectiveSegments ? { segments: effectiveSegments } : {}),
        ...(payload.userMessageItemId ? { userMessageItemId: payload.userMessageItemId } : {}),
      };
      // GUI threads route submit-while-working through the pending-steer
      // path. Renderers should call `setPendingSteer` directly for that case;
      // any `sendThreadInput` that lands here while working is treated as a
      // steer (replace-latest) for backwards compatibility.
      if (session.presentationMode === "gui" && session.status === "working") {
        this.stagePendingSteer(session, turn);
        this.fireSteerInterrupt(session);
        return;
      }
      if (session.presentationMode === "gui" && session.pendingSteer !== undefined) {
        // Drain in progress (cancel acked, slot still set). Replace it; the
        // existing drain-on-idle hook will pick up the new content.
        this.stagePendingSteer(session, turn);
        this.maybeDrainPendingSteer(session);
        return;
      }
      this.startStructuredTurn(session, turn);
      return;
    }

    const pty = requireSessionPty(session);
    await writeSubmittedPrompt(
      pty,
      session.adapter.buildDirectInput?.(
        prompt,
        effectiveSegments,
        session.config,
        session.projectLocation,
      ) ?? [prompt, "\r"],
      session.projectLocation,
    );

    await sleep(300);
    if (session.prevChunk.includes("[Pasted text")) {
      pty.write("\r");
    }
  }

  async interruptThread(payload: { threadId: string }): Promise<void> {
    const session = this.requireSession(payload.threadId);
    await this.interruptStructuredTurn(session);
  }

  async writeTerminal(payload: WriteTerminalPayload): Promise<void> {
    const shell = this.shellSessions.get(payload.threadId);
    if (shell) {
      shell.pty.write(payload.data);
      return;
    }
    const session = this.requireSession(payload.threadId);
    requireSessionPty(session).write(payload.data);
    this.maybeArmUserInterruptRecovery(session, payload.data);
  }

  /**
   * Fallback for Claude's hook-gap around user interrupts: arm a grace timer
   * when the user presses Esc / Ctrl+C while hooks are active and the session
   * is in a busy status. If no hook event flips state within the grace window
   * (it won't, for plain-text interrupts or permission-dialog dismiss), treat
   * it as a local idle transition. Hook-driven state changes cancel the timer
   * from `applyCliHookPluginState`.
   */
  private maybeArmUserInterruptRecovery(session: SessionRuntime, data: string): void {
    if (!session.hasCliHookPluginActivity) return;
    if (!isInterruptibleBusyStatus(session.status)) return;
    if (!isUserInterruptKeystroke(data)) return;

    if (session.userInterruptRecoveryTimer) {
      clearTimeout(session.userInterruptRecoveryTimer);
    }
    session.userInterruptRecoveryTimer = setTimeout(() => {
      session.userInterruptRecoveryTimer = undefined;
      if (!session.hasCliHookPluginActivity) return;
      if (!isInterruptibleBusyStatus(session.status)) return;
      this.outputPipeline.applyCliHookPluginState(session, {
        status: "idle",
        attention: "none",
      });
    }, USER_INTERRUPT_RECOVERY_GRACE_MS);
  }

  async resizeTerminal(payload: ResizeTerminalPayload): Promise<void> {
    const shell = this.shellSessions.get(payload.threadId);
    if (shell) {
      shell.pty.resize(payload.cols, payload.rows);
      return;
    }
    const session = this.sessions.get(payload.threadId);
    if (!session) {
      return;
    }
    session.terminalSize = { cols: payload.cols, rows: payload.rows };
    session.pty?.resize(payload.cols, payload.rows);
  }

  /**
   * Stage (or replace) the pending steer slot. Allocates a stable id on the
   * first stage and emits a `thread-pending-steer` event so the renderer can
   * paint the strip. Replace-latest semantics — a second submit-while-working
   * overwrites the existing slot rather than queueing.
   */
  private stagePendingSteer(session: SessionRuntime, turn: QueuedStructuredTurn): void {
    const id = session.pendingSteer?.id ?? `steer-${randomUUID()}`;
    const slot: PendingSteerSlot = {
      id,
      stagedAt: Date.now(),
      ...turn,
    };
    session.pendingSteer = slot;
    this.emitPendingSteer(session);
  }

  private clearPendingSteerSlot(session: SessionRuntime): void {
    if (session.pendingSteer === undefined) return;
    session.pendingSteer = undefined;
    this.emitPendingSteer(session);
  }

  private emitPendingSteer(session: SessionRuntime): void {
    const slot = session.pendingSteer;
    const pending: PendingSteerState | null = slot
      ? {
          id: slot.id,
          prompt: slot.prompt,
          stagedAt: slot.stagedAt,
          ...(slot.segments ? { segments: slot.segments } : {}),
        }
      : null;
    this.options.emit({
      type: "thread-pending-steer",
      threadId: session.threadId,
      pending,
    });
  }

  private fireSteerInterrupt(session: SessionRuntime): void {
    void this.interruptStructuredTurn(session).catch((error) => {
      if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }
      console.error("[supervisor] failed to interrupt structured turn:", error);
    });
  }

  private maybeDrainPendingSteer(session: SessionRuntime): void {
    if (session.presentationMode !== "gui") {
      return;
    }
    if (session.status !== "idle" && session.status !== "needs_reply") {
      return;
    }
    const slot = session.pendingSteer;
    if (!slot) return;
    session.pendingSteer = undefined;
    this.emitPendingSteer(session);
    const turn: QueuedStructuredTurn = {
      prompt: slot.prompt,
      config: slot.config,
      ...(slot.segments ? { segments: slot.segments } : {}),
      ...(slot.userMessageItemId ? { userMessageItemId: slot.userMessageItemId } : {}),
    };
    this.startStructuredTurn(session, turn);
  }

  private async interruptStructuredTurn(session: SessionRuntime): Promise<void> {
    if (session.presentationMode !== "gui") {
      return;
    }
    if (!session.structuredSession?.interruptTurn || session.structuredTurnInterruptRequested) {
      return;
    }
    session.structuredTurnInterruptRequested = true;
    try {
      await session.structuredSession.interruptTurn();
    } catch (error) {
      session.structuredTurnInterruptRequested = false;
      throw error;
    }
  }

  /**
   * Stage the user's steer message and fire the cancel notification. The
   * renderer calls this when submit-while-working happens on a GUI thread.
   * Drain is automatic on cancelled-stopReason via `maybeDrainPendingSteer`.
   */
  async setPendingSteer(payload: SetPendingSteerPayload): Promise<void> {
    const session = this.requireSession(payload.threadId);
    if (session.presentationMode !== "gui") {
      throw new Error("Pending steer is only supported for GUI-presentation threads.");
    }
    const usesStructuredFlow =
      session.adapter.capabilities.liveInputMode === "server" || session.presentationMode === "gui";
    if (!usesStructuredFlow || !session.structuredSession?.startTurn) {
      throw new Error("Thread does not support structured turns.");
    }
    const effectiveSegments = payload.segments
      ? rewriteSegmentsForWsl(payload.segments, session.projectLocation, {
          preserveImageAttachments: true,
        })
      : undefined;
    const prompt =
      effectiveSegments && effectiveSegments.length > 0
        ? (session.adapter.formatPromptSegments?.(effectiveSegments) ??
          defaultFormatPromptSegments(effectiveSegments))
        : payload.prompt;
    const turn: QueuedStructuredTurn = {
      prompt,
      config: payload.config,
      ...(effectiveSegments ? { segments: effectiveSegments } : {}),
    };
    this.stagePendingSteer(session, turn);
    if (session.status === "working") {
      this.fireSteerInterrupt(session);
    } else {
      // Status was already idle/needs_reply by the time we staged. Drain now
      // so the message doesn't sit unflushed.
      this.maybeDrainPendingSteer(session);
    }
  }

  /**
   * User aborted the steer (clicked the X on the strip). Clear the slot
   * without firing a new prompt. The cancel notification we already sent
   * still completes — the agent just stops without a replacement.
   */
  async clearPendingSteer(payload: ClearPendingSteerPayload): Promise<void> {
    const session = this.requireSession(payload.threadId);
    this.clearPendingSteerSlot(session);
  }

  private startStructuredTurn(session: SessionRuntime, turn: QueuedStructuredTurn): void {
    if (!session.structuredSession?.startTurn) {
      return;
    }
    // Optimistic user_message: paint the user's prompt in the chat pane
    // before the structured session's `prompt()` round-trip resolves so the
    // chat doesn't visually stall waiting on the agent. Only meaningful for
    // GUI threads — terminal threads render user input via PTY echo.
    // Prefer the renderer-supplied id when present (the chat pane has
    // already painted the message); otherwise emit one from the supervisor.
    const optimisticItemId =
      session.presentationMode === "gui" && turn.prompt.length > 0
        ? (turn.userMessageItemId ??
          this.emitOptimisticUserMessage(session.threadId, turn.prompt, turn.segments))
        : undefined;
    void session.structuredSession
      .startTurn(
        turn.prompt,
        turn.config,
        turn.segments,
        optimisticItemId ? { userMessageItemId: optimisticItemId } : undefined,
      )
      .catch((error) => {
        if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
          return;
        }
        this.failStructuredSession(session, error);
      });
  }

  async closeThread(payload: CloseThreadPayload): Promise<void> {
    const shell = this.shellSessions.get(payload.threadId);
    if (shell) {
      shell.ignoreExit = true;
      this.shellSessions.delete(payload.threadId);
      this.safeShellPtyKill(shell);
      return;
    }

    const existing = this.sessions.get(payload.threadId);
    if (!existing) {
      return;
    }

    existing.ignoreExit = true;
    this.outputPipeline.clearSessionTimers(existing);
    existing.stopSessionRefWatcher?.();
    existing.stopSessionRefWatcher = undefined;
    this.sessions.delete(payload.threadId);
    if (existing.sessionRef?.providerSessionId) {
      this.sessionsBySessionId.delete(existing.sessionRef.providerSessionId);
    }
    await existing.structuredSession?.dispose();
    if (existing.structuredSession) {
      await sleep(150);
    }
    this.safePtyKill(existing);
  }

  async startShell(payload: StartShellPayload): Promise<void> {
    const existing = this.shellSessions.get(payload.shellId);
    if (existing) {
      existing.ignoreExit = true;
      this.shellSessions.delete(payload.shellId);
      this.safeShellPtyKill(existing);
    }

    const shellCommand = this.buildShellCommand(payload.projectLocation);
    this.options.emit({ type: "thread-reset", threadId: payload.shellId });

    const shellEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color",
    };
    if (payload.projectLocation.kind === "wsl") {
      const existingWslEnv = process.env.WSLENV ?? "";
      if (!existingWslEnv.split(":").some((value) => value.replace(/\/.*/, "") === "TERM")) {
        shellEnv.WSLENV = existingWslEnv ? `${existingWslEnv}:TERM` : "TERM";
      }
    }

    const pty = spawn(shellCommand.command, shellCommand.args, {
      name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
      cols: 120,
      rows: 30,
      ...(shellCommand.cwd ? { cwd: shellCommand.cwd } : {}),
      env: shellEnv,
    });

    const session: ShellSessionRuntime = {
      instanceId: randomUUID(),
      shellId: payload.shellId,
      pty,
      outputLength: 0,
      ...(payload.worktreePath ? { worktreePath: payload.worktreePath } : {}),
    };

    this.shellSessions.set(payload.shellId, session);
    pty.onData((data) => {
      if (this.shellSessions.get(payload.shellId)?.instanceId !== session.instanceId) {
        return;
      }
      session.outputLength += data.length;
      if (this.options.isDev) {
        this.logWriter.append(this.resolveLogPath(payload.shellId.replace(/:/g, "_")), data);
      }
      this.options.emit({
        type: "thread-output",
        threadId: payload.shellId,
        data,
        outputLength: session.outputLength,
      });
    });

    pty.onExit(({ exitCode }) => {
      session.ptyExited = true;
      if (session.ignoreExit) {
        return;
      }
      this.shellSessions.delete(payload.shellId);
      this.options.emit({
        type: "thread-exited",
        threadId: payload.shellId,
        exitCode: exitCode ?? null,
      });
    });
  }

  async resolveThreadServerRequest(payload: ResolveThreadServerRequestPayload): Promise<void> {
    const session = this.requireSession(payload.threadId);
    if (!session.structuredSession?.resolveServerRequest) {
      throw new Error(`Thread ${payload.threadId} does not support server request resolution.`);
    }
    await session.structuredSession.resolveServerRequest(payload.requestId, payload.response);
  }

  readTerminalScrollback(threadId: string): string {
    return this.outputPipeline.readTerminalScrollback(this.sessions.get(threadId));
  }

  handlePtyDataForTests(session: SessionRuntime, data: string): void {
    this.outputPipeline.handlePtyData(session, data);
  }

  dispose(): void {
    this.flushRuntimeEvents();
    for (const session of this.sessions.values()) {
      session.ignoreExit = true;
      void session.structuredSession?.dispose();
      this.safePtyKill(session);
    }
    this.sessions.clear();
    this.sessionsBySessionId.clear();

    for (const shell of this.shellSessions.values()) {
      shell.ignoreExit = true;
      this.safeShellPtyKill(shell);
    }
    this.shellSessions.clear();
    this.logWriter.dispose();
  }

  private requireAdapter(kind: AgentKind): AgentAdapter {
    const adapter = this.options.adapters.get(kind);
    if (!adapter) {
      throw new Error(`Unsupported agent adapter: ${kind}`);
    }
    return adapter;
  }

  private requireSession(threadId: string): SessionRuntime {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`Unknown thread session: ${threadId}`);
    }
    return session;
  }

  /**
   * Hook-launch flags must stay in the option section of the argv. Appending
   * them after positional session ids / prompts makes Codex treat
   * `--enable codex_hooks` as trailing user input instead of a real flag.
   */
  private mergeCliHookExtraArgs(
    adapter: AgentAdapter,
    args: string[],
    extraArgs: string[],
    prompt: string,
    sessionRef?: SessionRef,
  ): string[] {
    if (extraArgs.length === 0) {
      return args;
    }

    switch (adapter.kind) {
      case "codex": {
        let trailingPositionals = 0;
        if (args[0] === "resume" || sessionRef) {
          trailingPositionals += 1;
        }
        if (prompt.trim().length > 0) {
          trailingPositionals += 1;
        }
        const insertAt = Math.max(args.length - trailingPositionals, args[0] === "resume" ? 1 : 0);
        return [...args.slice(0, insertAt), ...extraArgs, ...args.slice(insertAt)];
      }
      case "claude": {
        const insertAt = prompt.trim().length > 0 ? args.length - 1 : args.length;
        return [...args.slice(0, insertAt), ...extraArgs, ...args.slice(insertAt)];
      }
      default:
        return [...args, ...extraArgs];
    }
  }

  /**
   * Resolve the CLI hook plugin env + extra agent args that should be injected for
   * the given thread. Always returns a value so callers can splat
   * unconditionally; missing config produces an empty record/array.
   */
  private async resolveCliHookPluginExtras(
    threadId: string,
    agentKind: AgentKind,
    projectLocation: ProjectLocation,
  ): Promise<{ env: Record<string, string>; extraArgs: string[] }> {
    const adapter = this.options.adapters.get(agentKind);
    const liveInputMode = adapter?.capabilities.liveInputMode ?? "terminal";

    if (!this.options.resolvePluginEnvForSpawn) {
      hookDebugSpawn({
        threadId,
        agentKind,
        project: hookDebugProjectLabel(projectLocation),
        mode: "L2",
        label: "terminal TUI parse only (no hook coordinator wired)",
        liveInputMode,
      });
      return { env: {}, extraArgs: [] };
    }
    try {
      const resolved = await this.options.resolvePluginEnvForSpawn({
        threadId,
        agentKind,
        projectLocation,
      });
      const merged = resolved ?? { env: {}, extraArgs: [] };
      const hookUrl = merged.env.LIGHTCODE_HOOK_URL;
      const hasHookEnv = Boolean(hookUrl);

      if (liveInputMode === "server") {
        hookDebugSpawn({
          threadId,
          agentKind,
          project: hookDebugProjectLabel(projectLocation),
          mode: "L2",
          label: "structured / ACP–style agent (status from control channel, not CLI hook plugin)",
          liveInputMode,
          hookEnvInjected: hasHookEnv,
        });
      } else if (hasHookEnv) {
        const viaWslBridge = projectLocation.kind === "wsl";
        hookDebugSpawn({
          threadId,
          agentKind,
          project: hookDebugProjectLabel(projectLocation),
          mode: "L1",
          label: viaWslBridge
            ? "CLI hook plugin → in-distro HTTP bridge (WSL) → supervisor"
            : "CLI hook plugin → host HookIngress → supervisor",
          liveInputMode,
          hookUrl,
          extraCliArgs: merged.extraArgs.length,
        });
      } else {
        hookDebugSpawn({
          threadId,
          agentKind,
          project: hookDebugProjectLabel(projectLocation),
          mode: "L2",
          label:
            "CLI hook plugin inactive for this spawn (install/cache/transport/node in WSL, or not a hook-capable agent)",
          liveInputMode,
          extraCliArgs: merged.extraArgs.length,
        });
      }

      return merged;
    } catch (error) {
      console.warn("[supervisor] CLI hook plugin env resolution failed:", error);
      hookDebugSpawn({
        threadId,
        agentKind,
        project: hookDebugProjectLabel(projectLocation),
        mode: "L2",
        label: "resolvePluginEnvForSpawn threw; falling back to terminal parse only",
        liveInputMode,
        error: error instanceof Error ? error.message : String(error),
      });
      return { env: {}, extraArgs: [] };
    }
  }

  /**
   * Synchronously paint the user's typed prompt into the chat pane as a
   * canonical user_message item, ahead of the structured session's own
   * `prompt()` round-trip. The structured session below reuses this item id
   * via {@link StartTurnOptions} so its eventual emit is no-op'd by the
   * renderer's per-id dedupe, and the supervisor still drives the rest of the
   * canonical event stream.
   */
  private emitOptimisticUserMessage(
    threadId: string,
    prompt: string,
    segments?: PromptSegment[],
  ): string {
    const turnId = `turn-${randomUUID()}`;
    const itemId = `user-${randomUUID()}`;
    this.options.emit({
      type: "thread-runtime-event",
      threadId,
      event: { type: "turn.started", threadId, turnId },
    });
    this.options.emit({
      type: "thread-runtime-event",
      threadId,
      event: {
        type: "item.started",
        threadId,
        itemId,
        itemType: "user_message",
        payload: { content: buildPromptContentBlocks(prompt, segments) },
      },
    });
    this.options.emit({
      type: "thread-runtime-event",
      threadId,
      event: { type: "item.completed", threadId, itemId },
    });
    return itemId;
  }

  private emitOptimisticWorkingState(threadId: string, config: ThreadConfig): void {
    this.options.emit({
      type: "thread-state",
      threadId,
      status: "working",
      attention: "working",
      config,
      canResumeWithConfig: false,
      threadStatusSource: "server",
    });
  }

  private async startThreadInner(
    payload: StartThreadPayload & { threadId: string },
  ): Promise<StartThreadResult> {
    await this.closeThread({ threadId: payload.threadId });

    const adapter = this.requireAdapter(payload.agentKind);
    const isServerControlled = adapter.capabilities.liveInputMode === "server";
    // Per-thread mode wins over the adapter default. Chat-mode threads route
    // input/output through the structured session even for adapters whose
    // `liveInputMode` is "terminal".
    const requestedPresentation = payload.presentationMode ?? adapter.capabilities.presentationMode;
    const usesTerminalPresentation = requestedPresentation === "terminal";
    const useStructuredFlow = isServerControlled || !usesTerminalPresentation;
    const effectiveSegments = payload.segments
      ? rewriteSegmentsForWsl(payload.segments, payload.projectLocation, {
          preserveImageAttachments: useStructuredFlow,
        })
      : undefined;
    const initialPrompt =
      effectiveSegments && effectiveSegments.length > 0
        ? (adapter.formatPromptSegments?.(effectiveSegments) ??
          defaultFormatPromptSegments(effectiveSegments))
        : payload.prompt.trim();
    const shouldQueueInitialPrompt =
      !payload.sessionRef &&
      isServerControlled &&
      usesTerminalPresentation &&
      initialPrompt.length > 0 &&
      adapter.isReadyForInitialPrompt !== undefined;

    // Optimistic user_message: for GUI threads with a fresh prompt, surface
    // the user's typed text in the chat pane immediately — before the slow
    // structured-session work (process spawn + ACP handshake +
    // newSession/loadSession) runs. When the renderer has already painted an
    // optimistic message and shipped its id with the payload, we reuse that
    // id end-to-end so the chat pane never sees a duplicate.
    const optimisticUserMessageItemId =
      !usesTerminalPresentation && initialPrompt.length > 0 && !payload.sessionRef
        ? (payload.userMessageItemId ??
          this.emitOptimisticUserMessage(payload.threadId, initialPrompt, effectiveSegments))
        : undefined;
    if (optimisticUserMessageItemId) {
      this.emitOptimisticWorkingState(payload.threadId, payload.config);
    }

    const structuredSession = await this.createStructuredSession(
      adapter,
      payload.threadId,
      payload.projectLocation,
      payload.config,
      payload.sessionRef,
      requestedPresentation,
    );

    if (structuredSession?.activate) {
      try {
        await structuredSession.activate();
      } catch (error) {
        await structuredSession.dispose();
        throw error;
      }
    }

    let openedStructuredThreadId: string | undefined;
    if (structuredSession?.openThread) {
      try {
        openedStructuredThreadId = await structuredSession.openThread(
          payload.config,
          payload.sessionRef,
        );
      } catch (error) {
        await structuredSession.dispose();
        throw error;
      }
    }

    if (!usesTerminalPresentation) {
      if (!structuredSession) {
        throw new Error(
          `Agent ${payload.agentKind} does not support ${requestedPresentation} presentation.`,
        );
      }
      const resolvedSessionRef =
        payload.sessionRef ??
        (openedStructuredThreadId ? createKnownSessionRef(openedStructuredThreadId) : undefined);
      const session = this.spawnThread({
        threadId: payload.threadId,
        adapter,
        agentKind: payload.agentKind,
        projectLocation: payload.projectLocation,
        config: payload.config,
        initialSize: payload.initialSize,
        launchPrompt: "",
        structuredSession,
        ...(resolvedSessionRef ? { sessionRef: resolvedSessionRef } : {}),
        presentationMode: requestedPresentation,
        initialStatus: optimisticUserMessageItemId ? "working" : "idle",
        initialAttention: optimisticUserMessageItemId ? "working" : "none",
      });
      if (!payload.sessionRef && initialPrompt.length > 0 && structuredSession.startTurn) {
        void structuredSession
          .startTurn(
            initialPrompt,
            payload.config,
            effectiveSegments,
            optimisticUserMessageItemId
              ? { userMessageItemId: optimisticUserMessageItemId }
              : undefined,
          )
          .catch((error) => {
            if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
              return;
            }
            this.failStructuredSession(session, error);
          });
      }
      return { threadId: payload.threadId };
    }

    if (
      !payload.sessionRef &&
      useStructuredFlow &&
      initialPrompt.length > 0 &&
      !shouldQueueInitialPrompt &&
      structuredSession?.startTurn
    ) {
      void structuredSession
        .startTurn(initialPrompt, payload.config, effectiveSegments)
        .catch((error) => {
          console.error("[supervisor] initial turn failed:", error);
          const activeSession = this.sessions.get(payload.threadId);
          if (!activeSession) {
            return;
          }
          this.failStructuredSession(activeSession, error);
        });
    }

    if (shouldQueueInitialPrompt) {
      await structuredSession?.ensureResumeArtifacts?.();
    }

    const deferToTerminal = adapter.shouldDeferPromptToTerminal?.(payload.config) ?? false;
    // Use `initialPrompt` (the adapter-formatted version with `~/` shortening
    // and WSL path rewriting) so attachments hand off cleanly as the launch
    // arg instead of being staged for a deferred PTY-write.
    const launchPrompt = useStructuredFlow || deferToTerminal ? "" : initialPrompt;
    const argv = payload.sessionRef
      ? adapter.buildResumeArgv(
          payload.projectLocation,
          payload.config,
          launchPrompt,
          payload.sessionRef,
          structuredSession?.launchOptions,
        )
      : adapter.buildLaunchArgv(
          payload.projectLocation,
          payload.config,
          launchPrompt,
          payload.sessionRef,
          structuredSession?.launchOptions,
        );

    // Append CLI hook plugin args (e.g. Claude `--settings <path>`); env vars
    // (`LIGHTCODE_HOOK_URL`, `LIGHTCODE_HOOK_SECRET`, `LIGHTCODE_THREAD_ID`,
    // `LIGHTCODE_AGENT_KIND`, `LIGHTCODE_HOOK_PROTOCOL_VERSION`) flow through
    // `spawnThread` → `agentEnv` so they end up in the PTY env on every
    // platform (WSL, win32, posix). Failure to resolve plugin extras silently
    // degrades to L2 — the supervisor must never block thread creation on
    // the hook-plugin plumbing.
    const cliHookExtras = await this.resolveCliHookPluginExtras(
      payload.threadId,
      payload.agentKind,
      payload.projectLocation,
    );
    if (cliHookExtras.extraArgs.length > 0) {
      argv.args = this.mergeCliHookExtraArgs(
        adapter,
        argv.args,
        cliHookExtras.extraArgs,
        launchPrompt,
        payload.sessionRef,
      );
    }
    const command = resolveLaunchSpec(payload.projectLocation, argv);

    const keepStructuredSession = structuredSession && useStructuredFlow;
    if (structuredSession && !keepStructuredSession) {
      await structuredSession.dispose();
    }

    const resolvedSessionRef = payload.sessionRef ?? command.sessionRef;
    this.spawnThread({
      threadId: payload.threadId,
      adapter,
      agentKind: payload.agentKind,
      projectLocation: payload.projectLocation,
      config: payload.config,
      initialSize: payload.initialSize,
      launchPrompt,
      command,
      ...(Object.keys(cliHookExtras.env).length > 0 ? { extraEnv: cliHookExtras.env } : {}),
      ...(keepStructuredSession ? { structuredSession } : {}),
      ...(resolvedSessionRef ? { sessionRef: resolvedSessionRef } : {}),
      ...(shouldQueueInitialPrompt ? { pendingLaunchPrompt: initialPrompt } : {}),
      presentationMode: requestedPresentation,
      ...(deferToTerminal && !useStructuredFlow
        ? (() => {
            const preInputs = adapter.buildTerminalPreInputs?.(payload.config);
            return {
              ...(preInputs ? { pendingTerminalPreInputs: preInputs } : {}),
              pendingTerminalPrompt: initialPrompt,
              ...(effectiveSegments ? { pendingTerminalSegments: effectiveSegments } : {}),
            };
          })()
        : {}),
    });

    return { threadId: payload.threadId };
  }

  private async createStructuredSession(
    adapter: AgentAdapter,
    threadId: string,
    projectLocation: ProjectLocation,
    config: ThreadConfig,
    sessionRef?: SessionRef,
    presentationMode?: import("@/shared/contracts").ThreadPresentationMode,
  ): Promise<StructuredSessionHandle | undefined> {
    if (!adapter.createStructuredSession) {
      return undefined;
    }
    try {
      return await adapter.createStructuredSession({
        threadId,
        projectLocation,
        config,
        ...(sessionRef ? { sessionRef } : {}),
        ...(presentationMode ? { presentationMode } : {}),
      });
    } catch (error) {
      console.error("[supervisor] structured session creation failed:", error);
      return undefined;
    }
  }

  private spawnThread(input: {
    threadId: string;
    agentKind: AgentKind;
    adapter: AgentAdapter;
    projectLocation: ProjectLocation;
    config: ThreadConfig;
    initialSize: TerminalSize;
    launchPrompt: string;
    command?: CommandSpec;
    /**
     * Extra env injected into the agent PTY (merged on top of agentEnv +
     * provider spawnEnv). Currently used by the CLI hook ingress to ferry
     * `LIGHTCODE_HOOK_URL` / `LIGHTCODE_HOOK_SECRET` / `LIGHTCODE_THREAD_ID` etc.
     */
    extraEnv?: Record<string, string>;
    structuredSession?: StructuredSessionHandle;
    sessionRef?: SessionRef;
    pendingLaunchPrompt?: string;
    pendingTerminalPreInputs?: string[][];
    pendingTerminalPrompt?: string;
    pendingTerminalSegments?: PromptSegment[];
    presentationMode?: import("@/shared/contracts").ThreadPresentationMode;
    initialStatus?: import("@/shared/contracts").ThreadStatus;
    initialAttention?: import("@/shared/contracts").ThreadAttention;
  }): SessionRuntime {
    // `thread-reset` is only consumed by the terminal panel (xterm scrollback
    // reset) and the renderer-side runtime-event/server-request slice clear.
    // GUI threads have no terminal scrollback, and clearing the slice would
    // wipe the optimistic user_message we may have already painted ahead of
    // structured-session setup. Skip the reset for any GUI-presentation
    // thread (initial launch, resume, restart all run through here).
    const isGuiPresentation =
      input.presentationMode !== undefined && input.presentationMode !== "terminal";
    if (!isGuiPresentation) {
      this.options.emit({ type: "thread-reset", threadId: input.threadId });
    }

    const agentEnv = this.resolveAgentProcessEnv(input.adapter);
    const cliHookEnvInjected = Boolean(input.extraEnv?.LIGHTCODE_HOOK_URL);
    const providerEnv =
      input.projectLocation.kind === "wsl"
        ? input.adapter.spawnEnv?.wsl
        : input.adapter.spawnEnv?.native;
    if (providerEnv) {
      Object.assign(agentEnv, providerEnv);
    }
    if (input.extraEnv) {
      Object.assign(agentEnv, input.extraEnv);
    }
    Object.assign(
      agentEnv,
      getClaudeL2TerminalEnv({
        agentKind: input.agentKind,
        projectLocation: input.projectLocation,
        disableCliHookPlugin: this.readDisableCliHookPlugin(),
        cliHookEnvInjected,
      }),
    );
    const command = input.command
      ? injectWslEnv(input.command, input.projectLocation, agentEnv)
      : undefined;
    const pty = command
      ? spawn(command.command, command.args, {
          name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
          cols: input.initialSize.cols,
          rows: input.initialSize.rows,
          cwd: command.cwd ?? process.cwd(),
          env: {
            ...process.env,
            TERM: "xterm-256color",
            ...agentEnv,
          },
        })
      : undefined;
    const session: SessionRuntime = {
      instanceId: randomUUID(),
      threadId: input.threadId,
      agentKind: input.agentKind,
      adapter: input.adapter,
      ...(pty ? { pty } : {}),
      projectLocation: input.projectLocation,
      config: input.config,
      terminalSize: input.initialSize,
      launchPrompt: input.launchPrompt,
      ...(input.sessionRef ? { sessionRef: input.sessionRef } : {}),
      status: input.initialStatus ?? "launching",
      attention: input.initialAttention ?? "none",
      canResumeWithConfig: input.sessionRef !== undefined,
      outputLength: 0,
      pendingLaunchPrompt: input.pendingLaunchPrompt,
      pendingTerminalPreInputs: input.pendingTerminalPreInputs,
      pendingTerminalPrompt: input.pendingTerminalPrompt,
      pendingTerminalSegments: input.pendingTerminalSegments,
      ...(input.presentationMode ? { presentationMode: input.presentationMode } : {}),
      prevChunk: "",
      lastStrippedPtyChunk: "",
      ptyOscCarry: "",
      ...(cliHookEnvInjected ? { cliHookEnvInjected: true } : {}),
      ...(input.structuredSession ? { structuredSession: input.structuredSession } : {}),
    };

    this.sessions.set(input.threadId, session);
    if (session.sessionRef?.providerSessionId) {
      this.sessionsBySessionId.set(session.sessionRef.providerSessionId, session);
    }
    this.outputPipeline.emitState(session);

    input.structuredSession?.setListener({
      onClose: () => {
        if (
          this.sessions.get(session.threadId)?.instanceId !== session.instanceId ||
          session.ignoreExit
        ) {
          return;
        }
        this.handleStructuredSessionClosed(session);
      },
      onError: (errorMessage) => {
        if (
          this.sessions.get(session.threadId)?.instanceId !== session.instanceId ||
          session.ignoreExit
        ) {
          return;
        }
        this.outputPipeline.updateState(session, "error", "error", errorMessage);
      },
      onServerRequest: (request) => {
        if (
          this.sessions.get(session.threadId)?.instanceId !== session.instanceId ||
          session.ignoreExit
        ) {
          return;
        }
        this.options.emit({
          type: "thread-server-request",
          threadId: session.threadId,
          requestId: request.requestId,
          method: request.method,
          params: request.params,
        });
      },
      onUpdate: (update) => {
        if (
          this.sessions.get(session.threadId)?.instanceId !== session.instanceId ||
          session.ignoreExit
        ) {
          return;
        }
        const wasWorking = session.status === "working";
        const hadInterruptRequest = session.structuredTurnInterruptRequested === true;
        if (update.sessionRef) {
          const prevId = session.sessionRef?.providerSessionId;
          session.sessionRef = update.sessionRef;
          session.canResumeWithConfig = true;
          this.indexSessionRef(session, prevId);
        }

        const configChanged =
          update.config !== undefined && !isThreadConfigEqual(session.config, update.config);
        const stateChanged =
          session.status !== update.status ||
          session.attention !== update.attention ||
          update.errorMessage !== undefined;
        if (update.config) {
          session.config = update.config;
        }

        this.outputPipeline.updateState(
          session,
          update.status,
          update.attention,
          update.errorMessage,
        );
        if (update.status !== "working") {
          session.structuredTurnInterruptRequested = false;
        }
        if (
          session.presentationMode === "gui" &&
          (wasWorking || hadInterruptRequest) &&
          (update.status === "idle" || update.status === "needs_reply")
        ) {
          this.maybeDrainPendingSteer(session);
        }
        if (configChanged && !stateChanged && update.errorMessage === undefined) {
          this.outputPipeline.emitState(session);
        }
      },
      onRuntimeEvent: (event) => {
        if (
          this.sessions.get(session.threadId)?.instanceId !== session.instanceId ||
          session.ignoreExit
        ) {
          return;
        }
        this.enqueueRuntimeEvent(session.threadId, event);
      },
    });

    pty?.onData((data) => {
      if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }
      try {
        this.outputPipeline.handlePtyData(session, data);
      } catch (error) {
        console.error(
          `[supervisor] uncaught error in onData for thread ${session.threadId}:`,
          error,
        );
      }
    });

    pty?.onExit((event) => {
      session.ptyExited = true;
      if (session.ignoreExit) {
        return;
      }
      if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }
      void session.structuredSession?.dispose();
      this.outputPipeline.clearSessionTimers(session);
      this.outputPipeline.updateState(session, "inactive", "none");
      session.hasCliHookPluginActivity = false;
      session.cliHookEnvInjected = false;
      if (session.sessionRef?.providerSessionId) {
        this.sessionsBySessionId.delete(session.sessionRef.providerSessionId);
      }
      this.options.emit({
        type: "thread-exited",
        threadId: session.threadId,
        exitCode: event.exitCode,
      });
    });

    return session;
  }

  private pollSessionRefDiscovery(session: SessionRuntime): void {
    let attempt = 0;
    let polling = false;
    const existingIds = new Set<string>();
    for (const activeSession of this.sessions.values()) {
      if (activeSession.sessionRef && activeSession.threadId !== session.threadId) {
        existingIds.add(activeSession.sessionRef.providerSessionId);
      }
    }

    const poll = async () => {
      if (polling || session.sessionRef || session.status === "inactive" || attempt >= 5) {
        return;
      }
      polling = true;
      attempt += 1;
      try {
        const ref = await session.adapter.discoverSessionRef?.(session.projectLocation);
        if (ref && !session.sessionRef && !existingIds.has(ref.providerSessionId)) {
          session.sessionRef = ref;
          session.canResumeWithConfig = true;
          this.indexSessionRef(session, undefined);
          session.stopSessionRefWatcher?.();
          session.stopSessionRefWatcher = undefined;
          this.outputPipeline.emitState(session);
          return;
        }
      } catch {
        // retry later
      } finally {
        polling = false;
      }
      setTimeout(() => void poll(), 3000);
    };

    session.stopSessionRefWatcher = session.adapter.watchSessionRef?.(
      session.projectLocation,
      () => void poll(),
    );
    const initialDelay = session.adapter.initialSessionRefDiscoveryDelayMs ?? 0;
    if (initialDelay > 0) {
      setTimeout(() => void poll(), initialDelay);
      return;
    }
    void poll();
  }

  private async restartThread(
    session: SessionRuntime,
    prompt: string,
    config: ThreadConfig,
  ): Promise<void> {
    if (!session.sessionRef) {
      throw new Error("Session cannot be restarted without a known session reference.");
    }

    const isServerControlled = session.adapter.capabilities.liveInputMode === "server";
    const usesTerminalPresentation =
      (session.presentationMode ?? session.adapter.capabilities.presentationMode) === "terminal";
    const useStructuredFlow = isServerControlled || !usesTerminalPresentation;
    session.ignoreExit = true;
    await session.structuredSession?.dispose();
    if (session.structuredSession) {
      await sleep(150);
    }
    this.safePtyKill(session);

    const structuredSession = await this.createStructuredSession(
      session.adapter,
      session.threadId,
      session.projectLocation,
      config,
      session.sessionRef,
      session.presentationMode,
    );

    if (structuredSession?.activate) {
      try {
        await structuredSession.activate();
      } catch (error) {
        await structuredSession.dispose();
        throw error;
      }
    }

    if (structuredSession?.openThread) {
      try {
        await structuredSession.openThread(config, session.sessionRef);
      } catch (error) {
        await structuredSession.dispose();
        throw error;
      }
    }

    if (!usesTerminalPresentation) {
      if (!structuredSession) {
        throw new Error(`Thread ${session.threadId} cannot restart without a structured session.`);
      }
      const restarted = this.spawnThread({
        threadId: session.threadId,
        agentKind: session.agentKind,
        adapter: session.adapter,
        projectLocation: session.projectLocation,
        config,
        initialSize: session.terminalSize,
        launchPrompt: "",
        structuredSession,
        sessionRef: session.sessionRef,
        ...(session.presentationMode ? { presentationMode: session.presentationMode } : {}),
      });
      if (prompt.trim().length > 0 && structuredSession.startTurn) {
        const optimisticItemId = this.emitOptimisticUserMessage(session.threadId, prompt);
        void structuredSession
          .startTurn(prompt, config, undefined, { userMessageItemId: optimisticItemId })
          .catch((error) => {
            if (this.sessions.get(restarted.threadId)?.instanceId !== restarted.instanceId) {
              return;
            }
            this.outputPipeline.updateState(
              restarted,
              "error",
              "error",
              error instanceof Error ? error.message : String(error),
            );
          });
      }
      return;
    }

    const launchPrompt = useStructuredFlow ? "" : prompt;
    const cliHookExtras = await this.resolveCliHookPluginExtras(
      session.threadId,
      session.agentKind,
      session.projectLocation,
    );
    const argv = session.adapter.buildResumeArgv(
      session.projectLocation,
      config,
      launchPrompt,
      session.sessionRef,
      structuredSession?.launchOptions,
    );
    if (cliHookExtras.extraArgs.length > 0) {
      argv.args = this.mergeCliHookExtraArgs(
        session.adapter,
        argv.args,
        cliHookExtras.extraArgs,
        launchPrompt,
        session.sessionRef,
      );
    }
    const command = resolveLaunchSpec(session.projectLocation, argv);

    const keepStructuredSession = structuredSession && useStructuredFlow;
    if (structuredSession && !keepStructuredSession) {
      await structuredSession.dispose();
    }

    this.spawnThread({
      threadId: session.threadId,
      agentKind: session.agentKind,
      adapter: session.adapter,
      projectLocation: session.projectLocation,
      config,
      initialSize: session.terminalSize,
      launchPrompt,
      command,
      ...(Object.keys(cliHookExtras.env).length > 0 ? { extraEnv: cliHookExtras.env } : {}),
      ...(keepStructuredSession ? { structuredSession } : {}),
      sessionRef: session.sessionRef,
      ...(session.presentationMode ? { presentationMode: session.presentationMode } : {}),
    });
  }

  private recoverInvalidSessionRef(session: SessionRuntime): void {
    if (session.invalidSessionRecoveryStarted || !session.sessionRef) {
      return;
    }
    session.invalidSessionRecoveryStarted = true;
    void (async () => {
      if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }

      session.ignoreExit = true;
      session.stopSessionRefWatcher?.();
      session.stopSessionRefWatcher = undefined;
      await session.structuredSession?.dispose();
      if (session.structuredSession) {
        await sleep(150);
      }
      this.safePtyKill(session);

      if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }

      const cliHookExtras = await this.resolveCliHookPluginExtras(
        session.threadId,
        session.agentKind,
        session.projectLocation,
      );
      const argv = session.adapter.buildLaunchArgv(
        session.projectLocation,
        session.config,
        session.launchPrompt,
      );
      if (cliHookExtras.extraArgs.length > 0) {
        argv.args = this.mergeCliHookExtraArgs(
          session.adapter,
          argv.args,
          cliHookExtras.extraArgs,
          session.launchPrompt,
        );
      }
      const command = resolveLaunchSpec(session.projectLocation, argv);

      this.spawnThread({
        threadId: session.threadId,
        agentKind: session.agentKind,
        adapter: session.adapter,
        projectLocation: session.projectLocation,
        config: session.config,
        initialSize: session.terminalSize,
        launchPrompt: session.launchPrompt,
        command,
        ...(Object.keys(cliHookExtras.env).length > 0 ? { extraEnv: cliHookExtras.env } : {}),
      });
    })();
  }

  private handleStructuredSessionClosed(session: SessionRuntime): void {
    if (session.status === "inactive") {
      return;
    }
    this.outputPipeline.updateState(session, "inactive", "none");
    this.options.emit({
      type: "thread-exited",
      threadId: session.threadId,
      exitCode: null,
    });
    session.ignoreExit = true;
    session.stopSessionRefWatcher?.();
    session.stopSessionRefWatcher = undefined;
    setTimeout(() => this.safePtyKill(session), 150);
  }

  private startQueuedLaunchPrompt(session: SessionRuntime): void {
    if (!session.pendingLaunchPrompt || !session.structuredSession?.startTurn) {
      return;
    }
    const prompt = session.pendingLaunchPrompt;
    session.pendingLaunchPrompt = undefined;
    void session.structuredSession.startTurn(prompt, session.config).catch((error) => {
      if (this.sessions.get(session.threadId)?.instanceId !== session.instanceId) {
        return;
      }
      this.outputPipeline.updateState(
        session,
        "error",
        "error",
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  private safePtyKill(session: SessionRuntime): void {
    if (!session.pty) {
      return;
    }
    if (session.ptyExited) {
      return;
    }
    if (process.platform === "win32") {
      terminateProcessTree(session.pty.pid);
      return;
    }
    try {
      process.kill(session.pty.pid, 0);
    } catch {
      return;
    }
    session.pty.kill();
  }

  private safeShellPtyKill(session: ShellSessionRuntime): void {
    if (session.ptyExited) {
      return;
    }
    if (process.platform === "win32") {
      terminateProcessTree(session.pty.pid);
      return;
    }
    try {
      process.kill(session.pty.pid, 0);
    } catch {
      return;
    }
    session.pty.kill();
  }

  private buildShellCommand(location: ProjectLocation): {
    command: string;
    args: string[];
    cwd?: string;
  } {
    if (location.kind === "wsl") {
      return {
        command: getWslCommand(),
        args: ["-d", location.distro, "--cd", location.linuxPath],
      };
    }

    if (process.platform === "win32") {
      return {
        command: this.options.windowsShell.shell,
        args: [...this.options.windowsShell.args],
        cwd: location.path,
      };
    }

    const shell = process.env.SHELL || "/bin/bash";
    return {
      command: shell,
      args: ["-l"],
      cwd: location.path,
    };
  }

  private resolveLogPath(threadId: string): string {
    return join(this.options.logsDir, `${threadId}.log`);
  }

  private resolveHintLogPath(threadId: string): string {
    return join(this.options.logsDir, `${threadId}.hints.log`);
  }

  private resolveAgentProcessEnv(adapter: AgentAdapter): Record<string, string> {
    const settingDefs = adapter.capabilities.settingDefs ?? [];
    if (settingDefs.length === 0) {
      return {};
    }

    let settings = defaultSharedSettings;
    try {
      const raw = readFileSync(this.options.settingsPath, "utf8");
      settings = normalizeSharedSettings(JSON.parse(raw));
    } catch {
      // use defaults
    }

    const agentValues = settings.agentSettings[adapter.kind] ?? {};
    const env: Record<string, string> = {};
    for (const definition of settingDefs) {
      if (definition.platforms && !definition.platforms.includes(process.platform)) {
        continue;
      }
      const value = agentValues[definition.key] ?? definition.default;
      if (definition.type === "toggle") {
        if (value) {
          Object.assign(env, definition.env);
        }
      } else if (definition.type === "select") {
        env[definition.envVar] = String(value);
      }
    }
    return env;
  }
}
