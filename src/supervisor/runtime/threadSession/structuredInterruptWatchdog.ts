import type { SessionRuntime } from "../sessionTypes";
import { STRUCTURED_INTERRUPT_FORCE_STOP_MS } from "./userInterrupt";

export interface StructuredInterruptWatchdogContext {
  sessions: Map<string, SessionRuntime>;
  isDisposed(): boolean;
  clearPendingSteerSlot(session: SessionRuntime): void;
  completeForcedInterrupt(session: SessionRuntime): void;
}

/**
 * Force-stop watchdog for structured (GUI) turns. Owns the interrupt request
 * and its absolute deadline: if the provider has not acknowledged cancellation
 * before the grace period expires, dispose it and close the turn locally.
 */
export class StructuredInterruptWatchdog {
  constructor(private readonly ctx: StructuredInterruptWatchdogContext) {}

  async interruptStructuredTurn(session: SessionRuntime): Promise<void> {
    if (session.presentationMode !== "gui") {
      return;
    }
    if (!session.structuredSession?.interruptTurn || session.structuredTurnInterruptRequested) {
      return;
    }
    session.structuredTurnInterruptRequested = true;
    this.armStructuredInterruptWatchdog(session);
    try {
      await session.structuredSession.interruptTurn();
    } catch (error) {
      session.structuredTurnInterruptRequested = false;
      this.clearStructuredInterruptWatchdog(session);
      throw error;
    }
  }

  clearStructuredInterruptWatchdog(session: SessionRuntime): void {
    if (session.structuredInterruptWatchdog) {
      clearTimeout(session.structuredInterruptWatchdog);
      session.structuredInterruptWatchdog = undefined;
    }
  }

  /**
   * Arm the absolute force-stop deadline. Provider output does not extend it:
   * continuing to stream is not an acknowledgement of the user's Stop request.
   */
  armStructuredInterruptWatchdog(session: SessionRuntime): void {
    this.clearStructuredInterruptWatchdog(session);
    const instanceId = session.instanceId;
    session.structuredInterruptWatchdog = setTimeout(() => {
      session.structuredInterruptWatchdog = undefined;
      this.forceStopUnacknowledgedTurn(session.threadId, instanceId);
    }, STRUCTURED_INTERRUPT_FORCE_STOP_MS);
  }

  /**
   * The agent did not acknowledge Stop before the fixed deadline. Dispose the
   * structured session best-effort and close the turn locally; the manager will
   * recreate the provider process when the user sends the next message.
   */
  private forceStopUnacknowledgedTurn(threadId: string, instanceId: string): void {
    const session = this.ctx.sessions.get(threadId);
    if (!session || session.instanceId !== instanceId) {
      return;
    }
    if (this.ctx.isDisposed() || session.ignoreExit) {
      return;
    }
    if (session.status !== "working" || !session.structuredTurnInterruptRequested) {
      return;
    }
    this.clearStructuredInterruptWatchdog(session);
    session.structuredTurnInterruptRequested = false;
    this.ctx.clearPendingSteerSlot(session);
    const interruptedSession = session.structuredSession;
    interruptedSession?.forceCompleteTurn?.();
    session.ignoreExit = true;
    session.structuredSession = undefined;
    void Promise.resolve(interruptedSession?.dispose()).catch((error) => {
      console.error("[supervisor] failed to dispose force-stopped structured session:", error);
    });
    this.ctx.completeForcedInterrupt(session);
  }
}
