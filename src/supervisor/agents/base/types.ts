import type {
  AgentCapability,
  AgentKind,
  AgentProviderMetadata,
  AgentSlashCommand,
  AgentStatus,
  AuthState,
  ProjectLocation,
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadAttention,
  ThreadConfig,
  ThreadPresentationMode,
  ThreadServerRequestId,
  ThreadStatus,
} from "@/shared/contracts";
import type { OscNotification, OscShellEvent, OscTitle } from "@/shared/osc";

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  sessionRef?: SessionRef;
  /**
   * Environment variables that should be set for the agent process.
   * For WSL commands these are baked into the shell script as `export` statements
   * because `wsl.exe` does not forward Windows env vars into the distro.
   */
  env?: Record<string, string>;
}

export interface AgentEnvContext {
  envKind: "windows" | "wsl" | "posix";
  wslDistro?: string;
  /**
   * Lightcode data base dir for native (non-WSL) plugin staging. Populated by
   * the supervisor so dev runs (`~/.lightcode-dev`) stage plugins separately
   * from prod (`~/.lightcode`). WSL plugin installs ignore this and stage
   * into the distro's `$HOME/.lightcode/` via `resolveWslHomeDirectory`.
   */
  baseDir?: string;
}

export interface AgentLaunchOptions {
  suppressResumeConfigOverrides?: boolean;
  resumeThreadId?: string;
}

export interface StructuredSessionUpdate {
  status: ThreadStatus;
  attention: ThreadAttention;
  config?: ThreadConfig;
  sessionRef?: SessionRef;
  errorMessage?: string;
  slashCommands?: AgentSlashCommand[];
}

export interface StructuredSessionListener {
  onClose(): void;
  onError(errorMessage: string): void;
  onUpdate(update: StructuredSessionUpdate): void;
  onRuntimeEvent?(event: RuntimeEvent): void;
}

export interface StartTurnOptions {
  userMessageItemId?: string;
}

export interface ThreadHistoryEntry {
  messageId: string;
  role: "user" | "assistant";
  parts: ReadonlyArray<unknown>;
  info: unknown;
}

export interface ThreadHistory {
  providerSessionId: string;
  messages: ReadonlyArray<ThreadHistoryEntry>;
}

export interface StructuredSessionHandle {
  launchOptions: AgentLaunchOptions;
  activate?(): Promise<void>;
  openThread?(config: ThreadConfig, sessionRef?: SessionRef): Promise<string>;
  ensureResumeArtifacts?(): Promise<void>;
  waitForRolloutFile?(timeoutMs?: number): Promise<void>;
  startTurn?(
    prompt: string,
    config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void>;
  interruptTurn?(): Promise<void>;
  resolveServerRequest?(requestId: ThreadServerRequestId, response: unknown): Promise<void>;
  readThread?(): Promise<ThreadHistory>;
  rollbackThread?(numTurns: number): Promise<ThreadHistory>;
  setListener(listener: StructuredSessionListener): void;
  dispose(): Promise<void>;
}

export type ResolveExecutablePath = (command: string) => string | undefined;

export interface CreateStructuredSessionInput {
  threadId: string;
  projectLocation: ProjectLocation;
  config: ThreadConfig;
  sessionRef?: SessionRef;
  presentationMode?: ThreadPresentationMode;
  loadSessionErrorRewriter?: (error: unknown, sessionId: string) => Error;
}

export interface AgentArgvSpec {
  binary: string;
  args: string[];
  env?: Record<string, string>;
  sessionRef?: SessionRef;
}

export interface DetectProbeCtx {
  location: ProjectLocation;
  executablePath: string | undefined;
  version?: string | undefined;
}

export type AuthProbe = (ctx: DetectProbeCtx) => Promise<AuthState | undefined>;

export interface StatusProbeResult {
  authState?: AuthState;
  providerMetadata?: AgentProviderMetadata;
}

export type StatusProbe = (ctx: DetectProbeCtx) => Promise<StatusProbeResult | undefined>;

export interface DetectionSpec {
  kind: AgentKind;
  label: string;
  binary: string;
  loginCommand?: string;
  capabilities: AgentCapability;
  versionArgs?: string[];
  statusProbe?: StatusProbe;
  authProbes?: AuthProbe[];
  capabilitiesProbe?: (ctx: DetectProbeCtx) => Promise<Partial<AgentCapability> | undefined>;
}

export interface AgentMetadata {
  kind: AgentKind;
  label: string;
  binary?: string;
  capabilities: AgentCapability;
  spawnEnv?: {
    native?: Record<string, string>;
    wsl?: Record<string, string>;
  };
}

export interface AgentLauncher {
  buildLaunchArgv(
    location: ProjectLocation,
    config: ThreadConfig,
    prompt: string,
    sessionRef?: SessionRef,
    launchOptions?: AgentLaunchOptions,
  ): AgentArgvSpec;
  buildResumeArgv(
    location: ProjectLocation,
    config: ThreadConfig,
    prompt: string,
    sessionRef: SessionRef,
    launchOptions?: AgentLaunchOptions,
  ): AgentArgvSpec;
}

export interface AgentDetector {
  detectInstall(ctx?: AgentEnvContext): Promise<AgentStatus>;
}

export interface AgentPromptFormatter {
  shouldDeferPromptToTerminal?(config: ThreadConfig): boolean;
  buildTerminalPreInputs?(config: ThreadConfig): string[][] | undefined;
  buildDirectInput?(
    prompt: string,
    segments?: PromptSegment[],
    config?: ThreadConfig,
    projectLocation?: ProjectLocation,
  ): string[];
  formatPromptSegments?(segments: PromptSegment[]): string;
}

export interface AgentTerminalObserver {
  isReadyForInitialPrompt?(text: string): boolean;
  detectTerminalStatus?(text: string): TerminalStatusHint | null;
  shouldApplyTerminalStatusWhileHookActive?(hint: TerminalStatusHint): boolean;
  detectInvalidSessionRef?(text: string): boolean;
  detectAutoResponse?(text: string): string | null;
  workingSilenceTimeoutMs?: number | null;
  handleOscNotification?(notification: OscNotification): TerminalStatusHint | null;
  handleOscTitle?(title: OscTitle): TerminalStatusHint | null;
  handleOscShellEvent?(event: OscShellEvent): TerminalStatusHint | null;
  oscHintsDeferToHookPlugin?: boolean;
  syncConfigFromTerminalState?(input: SyncConfigFromTerminalStateInput): ThreadConfig | undefined;
}

export interface AgentSessionTracker {
  createInitialSessionRef(): SessionRef | undefined;
  createStructuredSession?(
    input: CreateStructuredSessionInput,
  ): Promise<StructuredSessionHandle | undefined>;
  discoverSessionRef?(location: ProjectLocation): Promise<SessionRef | undefined>;
  initialSessionRefDiscoveryDelayMs?: number;
  watchSessionRef?(location: ProjectLocation, onChanged: () => void): (() => void) | undefined;
}

export interface RunOneShotInput {
  location: ProjectLocation;
  model: string;
  effort?: string | undefined;
  prompt: string;
  signal?: AbortSignal | undefined;
}

export interface AgentOneShotRunner {
  defaultOneShotModel?: string;
  buildOneShotCommand?(
    model: string,
    effort?: string,
    prompt?: string,
  ): { command: string; args: string[]; stdin?: string } | undefined;
  runOneShot?(input: RunOneShotInput): Promise<string>;
  buildContextExtractionCommand?(
    sessionRef: SessionRef,
    location: ProjectLocation,
    model?: string,
  ): { command: string; args: string[]; stdin?: string } | undefined;
}

export interface AgentCliHookPluginSupport {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly minProtocolVersion: number;
  readonly partialL1?: boolean;
  isPluginSupported?(ctx: AgentEnvContext): Promise<boolean>;
  isPluginInstalled(ctx: AgentEnvContext): Promise<{ installed: boolean; version?: string }>;
  installPlugin(
    ctx: AgentEnvContext,
  ): Promise<{ ok: true; version: string } | { ok: false; reason: string }>;
  uninstallPlugin?(ctx: AgentEnvContext): Promise<void>;
  pluginLaunchExtras?(
    ctx: AgentEnvContext,
  ): Promise<{ args?: string[]; env?: Record<string, string> } | undefined>;
}

export interface AgentAdapter
  extends
    AgentMetadata,
    AgentLauncher,
    AgentDetector,
    AgentPromptFormatter,
    AgentTerminalObserver,
    AgentSessionTracker,
    AgentOneShotRunner,
    Partial<AgentCliHookPluginSupport> {}

export interface TerminalStatusHint {
  status: ThreadStatus;
  attention: ThreadAttention;
  planMode?: boolean | undefined;
  approvalPolicy?: string | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  corroborated?: boolean | undefined;
}

export interface SyncConfigFromTerminalStateInput {
  config: ThreadConfig;
  previousStatus: ThreadStatus;
  previousAttention: ThreadAttention;
  hint: TerminalStatusHint;
}

export interface HintEntry {
  re: RegExp;
  strong?: boolean;
}

export interface FindBestHintOptions {
  weakTailWindow?: number;
}
