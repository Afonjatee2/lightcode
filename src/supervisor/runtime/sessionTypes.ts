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
