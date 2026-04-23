import type { IPty } from "node-pty";
import type {
  AgentKind,
  ProjectLocation,
  PromptSegment,
  SessionRef,
  TerminalSize,
  ThreadAttention,
  ThreadConfig,
  ThreadStatus,
} from "@/shared/contracts";
import type { AgentAdapter, StructuredSessionHandle, TerminalStatusHint } from "../agents/base";
import type { TranscriptBuffer } from "./transcriptBuffer";

export interface SessionRuntime {
  instanceId: string;
  threadId: string;
  agentKind: AgentKind;
  adapter: AgentAdapter;
  pty: IPty;
  projectLocation: ProjectLocation;
  config: ThreadConfig;
  sessionRef?: SessionRef;
  status: ThreadStatus;
  attention: ThreadAttention;
  canResumeWithConfig: boolean;
  terminalSize: TerminalSize;
  launchPrompt: string;
  outputLength: number;
  structuredSession?: StructuredSessionHandle;
  ignoreExit?: boolean;
  invalidSessionRecoveryStarted?: boolean;
  ptyExited?: boolean;
  autoResponseEmitted?: boolean;
  sessionRefDiscoveryStarted?: boolean;
  stopSessionRefWatcher?: (() => void) | undefined;
  pendingLaunchPrompt?: string | undefined;
  pendingTerminalPreInputs?: string[][] | undefined;
  pendingTerminalWriteInFlight?: boolean | undefined;
  pendingTerminalPrompt?: string | undefined;
  pendingTerminalSegments?: PromptSegment[] | undefined;
  prevChunk: string;
  /**
   * ANSI-stripped text from the **latest** PTY `data` chunk (post OSC extract).
   * Used for `detectTerminalStatus` / `getLatestTerminalStatusHint` so L2 never
   * scans merged scrollback from `prevChunk`.
   */
  lastStrippedPtyChunk: string;
  /**
   * Bytes held between PTY `data` events when an OSC 9/777/99 sequence is
   * split across reads (no BEL/ST yet in this chunk).
   */
  ptyOscCarry?: string;
  lastStatusChangeAt?: number | undefined;
  pendingStatusHint?:
    | {
        status: ThreadStatus;
        attention: ThreadAttention;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  workingSilenceTimer?: ReturnType<typeof setTimeout> | undefined;
  outputTranscript?: TranscriptBuffer | undefined;
  /**
   * True when `LIGHTCODE_HOOK_URL` (and related vars) were injected into the
   * agent PTY at spawn (L1 path: host or WSL bridge → HookIngress). Used so the
   * UI can show Enhanced (Hooks) before the first routed hook event; L2 parsing
   * still waits for {@link hasCliHookPluginActivity}. Cleared on PTY exit.
   */
  cliHookEnvInjected?: boolean;
  /**
   * Set the first time we receive a CLI hook plugin event (hook POST) for this
   * session. Once true, terminal status from TUI parsing (L2 /
   * `detectTerminalStatus`) is disabled — hooks own thread status. Cleared on
   * PTY exit.
   */
  hasCliHookPluginActivity?: boolean;
  /** Timestamp of the last CLI hook plugin event — diagnostic / cache freshness. */
  lastCliHookPluginActivityAt?: number;
  /**
   * Armed when the user sends an interrupt keystroke (Esc alone, or Ctrl+C)
   * while hooks are active and the session is in a busy status. Claude Code
   * emits no hook on user interrupts (`Stop` is suppressed on user interrupt
   * per docs; `PostToolUseFailure` only fires if a tool was executing), so
   * without this fallback the UI stays stuck. If no hook event flips state
   * within the grace window, we transition to `idle` locally.
   * Cleared by `applyCliHookPluginState`, PTY exit, and `clearSessionTimers`.
   */
  userInterruptRecoveryTimer?: ReturnType<typeof setTimeout> | undefined;
}

export interface ShellSessionRuntime {
  instanceId: string;
  shellId: string;
  pty: IPty;
  outputLength: number;
  worktreePath?: string;
  ptyExited?: boolean;
  ignoreExit?: boolean;
}

export interface ThreadOutputPipelineCallbacks {
  onRecoverInvalidSessionRef(session: SessionRuntime): void;
  onStartQueuedLaunchPrompt(session: SessionRuntime): void;
  onStartSessionRefDiscovery(session: SessionRuntime): void;
}

export interface ThreadOutputPipelineHooks extends ThreadOutputPipelineCallbacks {
  emitState(session: SessionRuntime, errorMessage?: string): void;
  getLatestTerminalStatusHint(session: SessionRuntime): TerminalStatusHint | null;
}
