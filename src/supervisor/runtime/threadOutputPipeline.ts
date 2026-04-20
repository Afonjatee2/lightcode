import { setTimeout as sleep } from "node:timers/promises";
import { stripAnsiPreservingLayout } from "@/shared/ansi";
import type { ThreadAttention, ThreadStatus } from "@/shared/contracts";
import { extractOscNotifications } from "@/shared/osc";
import { isThreadConfigEqual } from "@/shared/contracts";
import type { TerminalStatusHint } from "../agents/base";
import { BufferedLogWriter } from "./bufferedLogWriter";
import type { SessionRuntime, ThreadOutputPipelineCallbacks } from "./sessionTypes";
import { TranscriptBuffer } from "./transcriptBuffer";
import { writeSubmittedPrompt } from "./threadSessionManager";

const STATUS_STABILIZATION_DELAY: Partial<Record<ThreadStatus, number>> = {
  working: 150,
  idle: 300,
};

const UNCORROBORATED_EXTRA_DELAY: Partial<Record<ThreadStatus, number>> = {
  idle: 200,
};

const DEFAULT_WORKING_SILENCE_TIMEOUT = 2000;

export interface ThreadOutputPipelineOptions extends ThreadOutputPipelineCallbacks {
  emit(event: import("@/shared/ipc").SupervisorEvent): void;
  isDev: boolean;
  logWriter: BufferedLogWriter;
  resolveLogPath(threadId: string): string;
  resolveHintLogPath(threadId: string): string;
}

export class ThreadOutputPipeline {
  constructor(private readonly options: ThreadOutputPipelineOptions) {}

  clearSessionTimers(session: SessionRuntime): void {
    if (session.pendingStatusHint) {
      clearTimeout(session.pendingStatusHint.timer);
      session.pendingStatusHint = undefined;
    }
    if (session.workingSilenceTimer) {
      clearTimeout(session.workingSilenceTimer);
      session.workingSilenceTimer = undefined;
    }
    if (session.userInterruptRecoveryTimer) {
      clearTimeout(session.userInterruptRecoveryTimer);
      session.userInterruptRecoveryTimer = undefined;
    }
  }

  getLatestTerminalStatusHint(session: SessionRuntime): TerminalStatusHint | null {
    if (
      session.hasCliHookPluginActivity ||
      session.adapter.capabilities.presentationMode !== "terminal" ||
      !session.adapter.detectTerminalStatus ||
      session.prevChunk.length === 0
    ) {
      return null;
    }
    return session.adapter.detectTerminalStatus(stripAnsiPreservingLayout(session.prevChunk));
  }

  readTerminalScrollback(session: SessionRuntime | undefined): string {
    if (!session?.outputTranscript) {
      return "";
    }
    return session.outputTranscript.readTail(100_000);
  }

  emitState(session: SessionRuntime, errorMessage?: string): void {
    this.options.emit({
      type: "thread-state",
      threadId: session.threadId,
      status: session.status,
      attention: session.attention,
      config: session.config,
      ...(session.sessionRef ? { sessionRef: session.sessionRef } : {}),
      canResumeWithConfig: session.canResumeWithConfig,
      ...(errorMessage ? { errorMessage } : {}),
    });
  }

  updateState(
    session: SessionRuntime,
    status: ThreadStatus,
    attention: ThreadAttention,
    errorMessage?: string,
  ): void {
    if (
      session.status === status &&
      session.attention === attention &&
      errorMessage === undefined
    ) {
      return;
    }

    this.clearSessionTimers(session);
    if (session.workingSilenceTimer && status !== "working") {
      clearTimeout(session.workingSilenceTimer);
      session.workingSilenceTimer = undefined;
    }

    session.status = status;
    session.attention = attention;
    session.lastStatusChangeAt = Date.now();
    this.emitState(session, errorMessage);
  }

  /**
   * Apply a CLI hook plugin state transition. Hook events are treated as 100%
   * authoritative — we bypass L2 stabilization timers and emit immediately.
   * When the plugin has posted at least once (`hasCliHookPluginActivity`), L2
   * does not run, so idle-gated terminal writes are flushed here on hook idle.
   */
  applyCliHookPluginState(
    session: SessionRuntime,
    change: { status: ThreadStatus; attention: ThreadAttention },
  ): void {
    // A real hook event beat the user-interrupt fallback — cancel it.
    if (session.userInterruptRecoveryTimer) {
      clearTimeout(session.userInterruptRecoveryTimer);
      session.userInterruptRecoveryTimer = undefined;
    }
    const statusChanged =
      session.status !== change.status || session.attention !== change.attention;
    this.updateState(session, change.status, change.attention);
    if (change.status === "idle") {
      this.flushPendingTerminalWritesIfIdle(session);
    }
    if (
      statusChanged &&
      session.adapter.discoverSessionRef &&
      !session.sessionRef &&
      !session.sessionRefDiscoveryStarted &&
      !session.pendingTerminalPrompt
    ) {
      session.sessionRefDiscoveryStarted = true;
      this.options.onStartSessionRefDiscovery(session);
    }
  }

  private flushPendingTerminalWritesIfIdle(session: SessionRuntime): void {
    if (session.pendingTerminalPreInputs?.length && !session.pendingTerminalWriteInFlight) {
      const chunks = session.pendingTerminalPreInputs.shift()!;
      if (!session.pendingTerminalPreInputs.length) {
        session.pendingTerminalPreInputs = undefined;
      }
      session.pendingTerminalWriteInFlight = true;
      void sleep(500)
        .then(() => writeSubmittedPrompt(session.pty, chunks))
        .then(() => {
          session.pendingTerminalWriteInFlight = false;
        });
      return;
    }
    if (session.pendingTerminalPrompt && !session.pendingTerminalWriteInFlight) {
      const prompt = session.pendingTerminalPrompt;
      const segments = session.pendingTerminalSegments;
      session.pendingTerminalPrompt = undefined;
      session.pendingTerminalSegments = undefined;
      void sleep(500).then(() =>
        writeSubmittedPrompt(
          session.pty,
          session.adapter.buildDirectInput?.(prompt, segments, session.config) ?? [prompt, "\r"],
        ),
      );
    }
  }

  handlePtyData(session: SessionRuntime, data: string): void {
    session.outputLength += data.length;
    session.outputTranscript ??= new TranscriptBuffer(200_000);
    session.outputTranscript.append(data);

    if (this.options.isDev) {
      this.options.logWriter.append(this.options.resolveLogPath(session.threadId), data);
    }

    this.options.emit({
      type: "thread-output",
      threadId: session.threadId,
      data,
      outputLength: session.outputLength,
    });

    const { cleaned: dataAfterOsc, notifications } = extractOscNotifications(data);
    for (const notification of notifications) {
      this.options.emit({
        type: "thread-osc-notification",
        threadId: session.threadId,
        title: notification.title,
        body: notification.body,
      });

      const oscHint = session.adapter.handleOscNotification?.(notification);
      if (oscHint) {
        this.updateState(session, oscHint.status, oscHint.attention);
      }
    }

    if (session.status === "launching") {
      this.updateState(session, "idle", "none");
    }

    const strippedData = stripAnsiPreservingLayout(dataAfterOsc);
    const usesTerminalPresentation = session.adapter.capabilities.presentationMode === "terminal";

    if (
      usesTerminalPresentation &&
      session.adapter.detectAutoResponse &&
      !session.autoResponseEmitted
    ) {
      const key = session.adapter.detectAutoResponse(strippedData);
      if (key) {
        session.autoResponseEmitted = true;
        session.pty.write(key);
      }
    }

    if (
      usesTerminalPresentation &&
      (session.adapter.isReadyForInitialPrompt || session.adapter.detectTerminalStatus)
    ) {
      // Hook-active fast path: keep streaming + launch-queue + invalid session ref
      // recovery only — skip prevChunk merge, second stripAnsi pass, and all L2
      // hint timers (major PTY hot-path savings on busy TUIs).
      if (session.hasCliHookPluginActivity) {
        if (session.workingSilenceTimer) {
          clearTimeout(session.workingSilenceTimer);
          session.workingSilenceTimer = undefined;
        }
        if (session.pendingStatusHint) {
          clearTimeout(session.pendingStatusHint.timer);
          session.pendingStatusHint = undefined;
        }
        if (
          session.pendingLaunchPrompt &&
          session.adapter.isReadyForInitialPrompt?.(strippedData)
        ) {
          this.options.onStartQueuedLaunchPrompt(session);
        }
        if (
          session.status === "launching" &&
          session.sessionRef &&
          session.adapter.detectInvalidSessionRef
        ) {
          const lastHome = Math.max(
            dataAfterOsc.lastIndexOf("\x1b[H"),
            dataAfterOsc.lastIndexOf("\x1b[1;1H"),
          );
          const combined =
            lastHome >= 0 ? dataAfterOsc.slice(lastHome) : session.prevChunk + dataAfterOsc;
          session.prevChunk = combined.length > 8192 ? combined.slice(-8192) : combined;
          const stripped = stripAnsiPreservingLayout(combined);
          if (session.adapter.detectInvalidSessionRef?.(stripped)) {
            this.options.onRecoverInvalidSessionRef(session);
            return;
          }
        }
        return;
      }

      const lastHome = Math.max(
        dataAfterOsc.lastIndexOf("\x1b[H"),
        dataAfterOsc.lastIndexOf("\x1b[1;1H"),
      );
      const combined =
        lastHome >= 0 ? dataAfterOsc.slice(lastHome) : session.prevChunk + dataAfterOsc;
      session.prevChunk = combined.length > 8192 ? combined.slice(-8192) : combined;
      const stripped = stripAnsiPreservingLayout(combined);

      if (
        session.status === "launching" &&
        session.sessionRef &&
        session.adapter.detectInvalidSessionRef?.(stripped)
      ) {
        this.options.onRecoverInvalidSessionRef(session);
        return;
      }

      let hint = session.adapter.detectTerminalStatus?.(stripped) ?? null;
      const suppressWeakStructuredIdle =
        session.agentKind === "codex" &&
        session.structuredSession !== undefined &&
        session.status === "working" &&
        hint?.status === "idle" &&
        !hint.corroborated;

      if (suppressWeakStructuredIdle) {
        const pending = session.pendingStatusHint;
        if (pending && pending.status === hint?.status) {
          clearTimeout(pending.timer);
          session.pendingStatusHint = undefined;
        }
        hint = null;
      }

      if (hint) {
        const nextConfig = session.adapter.syncConfigFromTerminalState?.({
          config: session.config,
          previousStatus: session.status,
          previousAttention: session.attention,
          hint,
        });
        const configChanged =
          nextConfig !== undefined && !isThreadConfigEqual(nextConfig, session.config);

        if (configChanged) {
          session.config = nextConfig!;
        }

        const suppressHint = session.pendingTerminalPrompt && hint.status !== "idle";
        if (
          !suppressHint &&
          (session.status !== hint.status || session.attention !== hint.attention)
        ) {
          const baseDelay = STATUS_STABILIZATION_DELAY[hint.status] ?? 0;
          const extraDelay =
            !hint.corroborated && baseDelay > 0
              ? (UNCORROBORATED_EXTRA_DELAY[hint.status] ?? 0)
              : 0;

          const recentlyBecameIdle =
            session.status === "idle" &&
            hint.status === "working" &&
            session.lastStatusChangeAt !== undefined &&
            Date.now() - session.lastStatusChangeAt < 2000;
          const delay = recentlyBecameIdle
            ? Math.max(baseDelay + extraDelay, 800)
            : baseDelay + extraDelay;

          if (delay === 0) {
            if (session.pendingStatusHint) {
              clearTimeout(session.pendingStatusHint.timer);
              session.pendingStatusHint = undefined;
            }
            this.updateState(session, hint.status, hint.attention);
          } else if (
            session.pendingStatusHint &&
            session.pendingStatusHint.status === hint.status &&
            session.pendingStatusHint.attention === hint.attention
          ) {
            // keep timer
          } else if (
            session.pendingStatusHint &&
            session.pendingStatusHint.status !== session.status &&
            hint.status === session.status
          ) {
            // keep pending transition
          } else {
            if (session.pendingStatusHint) {
              clearTimeout(session.pendingStatusHint.timer);
            }
            session.pendingStatusHint = {
              status: hint.status,
              attention: hint.attention,
              timer: setTimeout(() => {
                session.pendingStatusHint = undefined;
                if (session.status !== hint.status || session.attention !== hint.attention) {
                  this.updateState(session, hint.status, hint.attention);
                }
              }, delay),
            };
          }

          if (
            session.adapter.discoverSessionRef &&
            !session.sessionRef &&
            !session.sessionRefDiscoveryStarted &&
            !session.pendingTerminalPrompt
          ) {
            session.sessionRefDiscoveryStarted = true;
            this.options.onStartSessionRefDiscovery(session);
          }
        } else {
          if (session.pendingStatusHint && session.pendingStatusHint.status !== hint.status) {
            clearTimeout(session.pendingStatusHint.timer);
            session.pendingStatusHint = undefined;
          }
          if (configChanged) {
            this.emitState(session);
          }
        }

        this.writeHintLog(session, stripped, hint);
      }

      if (session.workingSilenceTimer) {
        clearTimeout(session.workingSilenceTimer);
        session.workingSilenceTimer = undefined;
      }
      const workingSilenceTimeoutMs =
        session.adapter.workingSilenceTimeoutMs === undefined
          ? DEFAULT_WORKING_SILENCE_TIMEOUT
          : session.adapter.workingSilenceTimeoutMs;
      if (
        session.status === "working" &&
        workingSilenceTimeoutMs !== null &&
        workingSilenceTimeoutMs > 0
      ) {
        session.workingSilenceTimer = setTimeout(() => {
          session.workingSilenceTimer = undefined;
          if (session.status === "working") {
            const latestHint = this.getLatestTerminalStatusHint(session);
            if (latestHint && latestHint.status !== "idle" && latestHint.corroborated !== false) {
              return;
            }
            this.updateState(session, "idle", "none");
          }
        }, workingSilenceTimeoutMs);
      }

      if (session.pendingLaunchPrompt && session.adapter.isReadyForInitialPrompt?.(strippedData)) {
        this.options.onStartQueuedLaunchPrompt(session);
      }

      if (hint?.status === "idle") {
        this.flushPendingTerminalWritesIfIdle(session);
      }
    }
  }

  private writeHintLog(
    session: SessionRuntime,
    stripped: string,
    hint: { status: string; attention: string } | null,
  ): void {
    if (!this.options.isDev) {
      return;
    }
    const tail = stripped.slice(-300);
    const timestamp = new Date().toISOString();
    const entry = [
      `--- ${timestamp} status=${session.status} hint=${hint?.status ?? "null"} ---`,
      tail,
      "",
    ].join("\n");
    this.options.logWriter.append(this.options.resolveHintLogPath(session.threadId), entry);
  }
}
