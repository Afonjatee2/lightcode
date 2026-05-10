import { existsSync, watch as fsWatch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { toWslUncPath } from "@/shared/wsl";

const execFileAsync = promisify(execFile);
import type { OscNotification, OscShellEvent, OscTitle } from "@/shared/osc";
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
  ThreadServerRequestId,
  ThreadAttention,
  ThreadConfig,
  ThreadPresentationMode,
  ThreadStatus,
} from "@/shared/contracts";
import { primeAgentBinaryPath, resolveAgentBinaryPath } from "./binaryResolver";
import { clearProjectNodeBinCache, resolveProjectNodeBin } from "./projectNodeResolver";

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
  onServerRequest(request: {
    requestId: ThreadServerRequestId;
    method: string;
    params: unknown;
  }): void;
  onUpdate(update: StructuredSessionUpdate): void;
  /**
   * Emit a canonical chat-runtime event (per-message item lifecycle, content
   * streams, approvals, etc.). Optional — adapters that have not yet wired up
   * their canonical-event mapper can omit it; the chat UI will simply have no
   * structured items for those threads.
   */
  onRuntimeEvent?(event: RuntimeEvent): void;
}

/** Per-call options for {@link StructuredSessionHandle.startTurn}. */
export interface StartTurnOptions {
  /**
   * Pre-allocated runtime item id for the user_message event. The runtime
   * emits an optimistic `item.started`/`item.completed` for the user's typed
   * prompt before the structured session is even spawned, so the chat pane
   * can render it instantly. Passing the same id here lets the structured
   * session's own emit dedupe via the renderer's per-id check.
   */
  userMessageItemId?: string;
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
  setListener(listener: StructuredSessionListener): void;
  dispose(): Promise<void>;
}

type ResolveExecutablePath = (command: string) => string | undefined;

export interface CreateStructuredSessionInput {
  threadId: string;
  projectLocation: ProjectLocation;
  config: ThreadConfig;
  sessionRef?: SessionRef;
  /**
   * Per-thread presentation mode at launch. Adapters whose structured session
   * is only required for chat mode (e.g. Codex's app-server) can
   * return `undefined` for terminal-mode threads to skip the spawn.
   */
  presentationMode?: ThreadPresentationMode;
}

/**
 * Provider launch description: what to run, not how to run it.
 * Adapters return this from `buildLaunchArgv` / `buildResumeArgv`; the runtime
 * passes it to `resolveLaunchSpec` which handles WSL wrapping, login-shell,
 * env injection, and Windows/POSIX quoting uniformly.
 */
export interface AgentArgvSpec {
  binary: string;
  args: string[];
  env?: Record<string, string>;
  sessionRef?: SessionRef;
}

/**
 * Context passed to detection probes (auth/capability). Probes run AFTER the
 * engine has resolved the executable path; a missing `executablePath` means
 * the binary is not installed — most probes should return `undefined` then.
 */
export interface DetectProbeCtx {
  location: ProjectLocation;
  executablePath: string | undefined;
  /** Semver text from `readDetectedVersion` (same `--version` probe as install detection). */
  version?: string | undefined;
}

export type AuthProbe = (ctx: DetectProbeCtx) => Promise<AuthState | undefined>;

export interface StatusProbeResult {
  authState?: AuthState;
  providerMetadata?: AgentProviderMetadata;
}

export type StatusProbe = (ctx: DetectProbeCtx) => Promise<StatusProbeResult | undefined>;

/**
 * Declarative install-detection for a provider. Replaces the WSL vs native
 * branching + `command -v` probe + version fetch + auth/capability probe
 * scaffolding that each adapter used to reimplement.
 *
 * `authProbes` run in order; the first to return `"authenticated"` wins.
 * `"unknown"` and `"missing"` are recorded but let later probes override
 * with `"authenticated"`. `undefined` skips the probe.
 *
 * `statusProbe` can return richer provider-account metadata alongside an
 * auth-state hint from a first-party CLI command. It runs in parallel with the
 * optional capability probe.
 *
 * `capabilitiesProbe` returns a partial merged on top of `capabilities`.
 */
export interface DetectionSpec {
  kind: AgentKind;
  label: string;
  binary: string;
  capabilities: AgentCapability;
  versionArgs?: string[];
  statusProbe?: StatusProbe;
  authProbes?: AuthProbe[];
  capabilitiesProbe?: (ctx: DetectProbeCtx) => Promise<Partial<AgentCapability> | undefined>;
}

// Slice interfaces — composed into AgentAdapter below. Consumers can accept
// the narrow slice they need (e.g. one-shot runners don't need the launcher).

export interface AgentMetadata {
  kind: AgentKind;
  label: string;
  /**
   * The CLI command name (e.g. `claude`, `codex`). Used by AgentStatusService
   * to batch-resolve every adapter's binary in a single login-shell call —
   * without this we'd spawn one cold zsh per adapter and macOS GUI launches
   * would intermittently time out.
   */
  binary?: string;
  capabilities: AgentCapability;
  /**
   * Extra process env the runtime should merge into the PTY spawn. Static —
   * the runtime reads this before spawn; adapters declare per-platform needs
   * (e.g. `BROWSER=/bin/true` for providers that open OAuth flows under WSL).
   */
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
  /**
   * Return true when the initial prompt must be typed into the TUI after idle
   * rather than passed as a CLI argument (e.g. Codex plan mode needs `/plan`
   * sent first). The runtime will set pendingTerminalPrompt accordingly.
   */
  shouldDeferPromptToTerminal?(config: ThreadConfig): boolean;
  /**
   * Return chunk sequences that must be sent to the TUI (each waiting for idle)
   * before the deferred prompt. E.g. `[["/plan", "\r"]]` sends `/plan↵` on the
   * first idle, then the prompt on the next idle.
   */
  buildTerminalPreInputs?(config: ThreadConfig): string[][] | undefined;
  buildDirectInput?(
    prompt: string,
    segments?: PromptSegment[],
    config?: ThreadConfig,
    projectLocation?: ProjectLocation,
  ): string[];
  /**
   * Format structured prompt segments into a prompt string for this agent.
   * Each adapter decides how to represent file references (e.g. Claude: `@path`,
   * Codex ACP: structured attachment, Gemini ACP: file part, etc.).
   * If not implemented, the runtime uses a default `@path` flattening.
   */
  formatPromptSegments?(segments: PromptSegment[]): string;
}

export interface AgentTerminalObserver {
  /** Detect when the PTY is ready to accept an initial queued launch prompt. */
  isReadyForInitialPrompt?(text: string): boolean;
  detectTerminalStatus?(text: string): TerminalStatusHint | null;
  /**
   * Hooks normally own status once injected. Some CLIs have hook coverage gaps
   * for interactive prompts, so adapters may opt specific L2 hints back in.
   * TODO: shrink as upstream hook coverage improves — currently used by Gemini
   * for `needs_reply` / `needs_approval` because its `Notification` event
   * doesn't fire on the `Enter to select` interactive picker.
   */
  shouldApplyTerminalStatusWhileHookActive?(hint: TerminalStatusHint): boolean;
  detectInvalidSessionRef?(text: string): boolean;
  /** Detect TUI prompts that should be auto-dismissed and return the key to send, or null. */
  detectAutoResponse?(text: string): string | null;
  /**
   * Optional PTY-silence fallback (ms) while the agent is marked working.
   * Set to null to disable the fallback for TUIs that can stay quiet mid-turn.
   */
  workingSilenceTimeoutMs?: number | null;
  /**
   * Handle an OSC notification extracted from the PTY stream.
   * Return a status hint if the notification maps to a known agent state,
   * or null to ignore it. Hints returned here are always treated as corroborated.
   */
  handleOscNotification?(notification: OscNotification): TerminalStatusHint | null;
  /**
   * Handle an OSC 0/1/2 title sequence extracted from the PTY stream.
   * Both Codex and Claude Code animate their working-state spinner inside the
   * terminal title (braille range U+2800–U+28FF), which gives us a structured
   * L2 `working` signal without TUI text parsing. Return a status hint or null.
   */
  handleOscTitle?(title: OscTitle): TerminalStatusHint | null;
  /**
   * Handle a VS Code shell-integration event (OSC 633: prompt/command/exit
   * markers, cwd updates). Emitted by shells with VS Code shell integration
   * sourced — useful as an L2 source for command boundaries when no hook
   * plugin is wired. Return a status hint or null.
   */
  handleOscShellEvent?(event: OscShellEvent): TerminalStatusHint | null;
  /**
   * Treat OSC-derived hints as **L2 fallback**: suppress them while the CLI
   * hook plugin is active (hooks own status). Notifications are still emitted
   * to the renderer; only the status transition is skipped.
   *
   * Agents where OSC is the primary lifecycle signal should leave this unset
   * (defaults to false → OSC always applies).
   */
  oscHintsDeferToHookPlugin?: boolean;
  /** Allow the adapter to reconcile config from TUI-derived state transitions it owns. */
  syncConfigFromTerminalState?(input: SyncConfigFromTerminalStateInput): ThreadConfig | undefined;
}

export interface AgentSessionTracker {
  createInitialSessionRef(): SessionRef | undefined;
  createStructuredSession?(
    input: CreateStructuredSessionInput,
  ): Promise<StructuredSessionHandle | undefined>;
  /** Discover the session ID after PTY spawn (e.g. by querying the CLI). */
  discoverSessionRef?(location: ProjectLocation): Promise<SessionRef | undefined>;
  /** Optional delay before the first session discovery attempt. */
  initialSessionRefDiscoveryDelayMs?: number;
  /** Optional fast-path watcher that triggers when session discovery should retry. */
  watchSessionRef?(location: ProjectLocation, onChanged: () => void): (() => void) | undefined;
}

export interface AgentOneShotRunner {
  /** Default model for lightweight one-shot tasks like commit message generation. */
  defaultOneShotModel?: string;
  /**
   * Build a command for one-shot prompt→response (e.g. commit-msg gen).
   * Prompt is piped via stdin.
   */
  buildOneShotCommand?(
    model: string,
    effort?: string,
    prompt?: string,
  ): { command: string; args: string[]; stdin?: string } | undefined;
  /**
   * Build a command that extracts a context summary from an active session.
   * Used by "Continue in Other Provider" to hand off conversation context.
   * Typically combines print mode with --resume to load the full session.
   */
  buildContextExtractionCommand?(
    sessionRef: SessionRef,
    location: ProjectLocation,
    model?: string,
  ): { command: string; args: string[]; stdin?: string } | undefined;
}

/**
 * **CLI hook plugin** support — the provider ships an in-process plugin that
 * the agent CLI loads, which forwards lifecycle events out of band (HTTP POST
 * to the supervisor's hook ingress) instead of forcing the supervisor to
 * scrape TUI output.
 *
 * Adapters that don't have a plugin simply leave this slice unimplemented;
 * the runtime treats them as terminal-parse-only (L2 / regex) and never
 * prompts the user about plugin installation.
 *
 * The runtime only knows the interface — it never branches on `agentKind` to
 * decide whether hook plugins are available, what to install, or how to verify
 * it.
 */
export interface AgentCliHookPluginSupport {
  /** Stable id for cache + telemetry, e.g. `lightcode-status@claude`. */
  readonly pluginId: string;
  /** Plugin semver, sourced from the plugin's `plugin.json` at build. */
  readonly pluginVersion: string;
  /** Earliest hook protocol the provider's forwarder script can produce. */
  readonly minProtocolVersion: number;
  /**
   * When true, L1 hook events update status for the transitions they cover
   * but L2 (terminal/OSC parsing) keeps running for the rest. Used by
   * providers whose hook event vocabulary lacks a clean turn-finished signal
   * (e.g. GitHub Copilot CLI: no `agentStop`, `sessionEnd` only fires on
   * full-session termination). Default `false` — L1 alone owns status when
   * any hook is wired.
   */
  readonly partialL1?: boolean;

  /**
   * Quick gate before doing any IO. Return false to short-circuit the install
   * path (e.g. unsupported platform/runtime). The default behaviour when this
   * method is omitted is "always supported".
   */
  isPluginSupported?(ctx: AgentEnvContext): Promise<boolean>;
  /**
   * Returns whether the plugin is currently installed on disk (no probe via
   * the agent CLI). Used by the cache layer to decide whether to skip
   * `installPlugin`.
   */
  isPluginInstalled(ctx: AgentEnvContext): Promise<{ installed: boolean; version?: string }>;
  /**
   * Synchronise the provider's plugin assets (forward script, hooks config)
   * to a stable location the agent CLI will load. Must be idempotent.
   */
  installPlugin(
    ctx: AgentEnvContext,
  ): Promise<{ ok: true; version: string } | { ok: false; reason: string }>;
  /** Optional teardown for tests / uninstall flows. */
  uninstallPlugin?(ctx: AgentEnvContext): Promise<void>;

  /**
   * Optional CLI args / env additions that wire the agent process to the
   * installed plugin (e.g. Claude needs `--settings <generated-hooks.json>`).
   * Returned record is merged on top of `AgentArgvSpec.env` and the args are
   * appended verbatim.
   */
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
  /**
   * Whether multiple independent signals corroborate this status.
   * When true, the runtime uses the standard stabilization delay.
   * When false/undefined, idle/working transitions get an extra delay
   * to guard against false positives from partial TUI redraws.
   */
  corroborated?: boolean | undefined;
}

export interface SyncConfigFromTerminalStateInput {
  config: ThreadConfig;
  previousStatus: ThreadStatus;
  previousAttention: ThreadAttention;
  hint: TerminalStatusHint;
}

export function buildWindowsCmdCommand(cwd: string, command: string, args: string[]): CommandSpec {
  return {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
    cwd,
  };
}

function getWindowsSystemCommand(name: string): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return join(systemRoot, "System32", name);
}

export function getWslCommand(): string {
  return getWindowsSystemCommand("wsl.exe");
}

/**
 * Build a `export K=V; ` prefix string for injecting env vars into a POSIX shell script.
 * Returns an empty string when there are no env vars to inject.
 */
function buildPosixExportPrefix(env: Record<string, string> | undefined): string {
  if (!env) return "";
  const entries = Object.entries(env);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `export ${k}=${quotePosixShellArg(v)}`).join("; ") + "; ";
}

function getPosixLoginShellArgs(script: string): string[] {
  return process.platform === "darwin" ? ["-l", "-i", "-c", script] : ["-l", "-c", script];
}

/**
 * Inject environment variables into an already-built WSL CommandSpec.
 * The WSL command structure from `buildAgentCommand` always ends with
 * `[..., shellPath, "-l", "-i", "-c", script]`, so we prepend `export`
 * statements to the script string.
 *
 * For non-WSL commands, the env is stored on `CommandSpec.env` and merged
 * into the PTY spawn options by the caller — no script rewriting needed.
 */
export function injectWslEnv(
  spec: CommandSpec,
  location: ProjectLocation,
  env: Record<string, string>,
): CommandSpec {
  if (location.kind !== "wsl" || Object.keys(env).length === 0) return spec;

  const prefix = buildPosixExportPrefix(env);
  if (!prefix) return spec;

  // The script is always the last arg after "-c".
  const args = [...spec.args];
  const scriptIdx = args.length - 1;
  args[scriptIdx] = `${prefix}${args[scriptIdx]}`;
  return { ...spec, args };
}

export function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Detect the best available shell. Returns a shell path on Windows (pwsh > powershell > cmd), or `true` on Unix (default shell). */
export function detectShell(
  resolvePath: ResolveExecutablePath = resolveExecutablePath,
): string | true {
  if (process.platform !== "win32") return true;
  return (
    resolvePath("pwsh.exe") ??
    resolvePath("pwsh") ??
    resolvePath("powershell.exe") ??
    resolvePath("powershell") ??
    true
  );
}

export function buildWindowsCommand(
  cwd: string,
  command: string,
  args: string[],
  resolvePath: ResolveExecutablePath = resolveExecutablePath,
): CommandSpec {
  const shell = detectShell(resolvePath);
  if (typeof shell === "string") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$cmd = ${quotePowerShellLiteral(command)}`,
      `$args = @(${args.map(quotePowerShellLiteral).join(", ")})`,
      "& $cmd @args",
    ].join("; ");

    return {
      command: shell,
      args: ["-NoLogo", "-NoProfile", "-EncodedCommand", encodePowerShellCommand(script)],
      cwd,
    };
  }

  return buildWindowsCmdCommand(cwd, command, args);
}

/**
 * Build a command spec for POSIX systems (macOS/Linux).
 *
 * Fast path: when given an absolute binary path, spawn directly and inject
 * the user's full shell env (captured once during `primeExecutablePathCache`).
 * This skips the interactive login shell init — on macOS with oh-my-zsh /
 * fnm / asdf / starship that's ~1.3-1.9s per spawn — while still giving the
 * child the same env it would inherit from the user's terminal: PATH plus
 * NVM_DIR, HOMEBREW_PREFIX, EDITOR, LANG, custom exports, etc. Bare names
 * still wrap in `$SHELL -l [-i] -c` so unprimed binaries are resolvable.
 */
function buildPosixCommand(cwd: string, command: string, args: string[]): CommandSpec {
  if (command.startsWith("/")) {
    const env = withProjectNodeBin(cwd, primedPosixEnv);
    return {
      command,
      args,
      cwd,
      ...(env ? { env: { ...env } } : {}),
    };
  }

  const shell = process.env.SHELL || "/bin/bash";
  const script = `exec ${[command, ...args].map(quotePosixShellArg).join(" ")}`;
  const env = withProjectNodeBin(cwd, undefined);
  return {
    command: shell,
    args: getPosixLoginShellArgs(script),
    cwd,
    ...(env ? { env } : {}),
  };
}

/**
 * Prepend the project's pinned Node bin (from .nvmrc / .node-version) to
 * `PATH`. Without this, agents launched in a project that pins Node 24
 * inherit the supervisor's home-shell Node when shelling out to npx/node.
 */
function withProjectNodeBin(
  cwd: string,
  baseEnv: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const projectBin = resolveProjectNodeBin(cwd, baseEnv?.NVM_DIR);
  if (!projectBin) return baseEnv;
  const basePath = baseEnv?.PATH ?? process.env.PATH ?? "";
  const merged = basePath ? `${projectBin}:${basePath}` : projectBin;
  return { ...(baseEnv ?? {}), PATH: merged };
}

/**
 * Build a command spec for an agent CLI across all platforms.
 * Agent adapters should use this - no platform branching needed.
 *
 * Handles:
 * - "windows" → PowerShell or cmd.exe
 * - "wsl" → wsl.exe with Linux shell
 * - "posix" → macOS/Linux with $SHELL or /bin/bash
 */
export function buildAgentCommand(
  location: ProjectLocation,
  command: string,
  args: string[],
  resolvedExecPath?: string,
  env?: Record<string, string>,
): CommandSpec {
  if (location.kind === "wsl") {
    // Always launch the agent through `bash -l -i -c` so the user's rc files
    // (nvm/fnm/asdf init, PATH overrides, shell functions) are sourced. Hooks
    // spawned by the agent inherit this env — without `-l -i`, Windows-side
    // tooling reachable via `/mnt/c` interop can shadow Linux node from a
    // version manager and break things like `npx` (e.g. fnm shims that exec a
    // node not on PATH).
    const shellPath = resolveWslShellPath(location.distro);
    const execCommand = resolvedExecPath ?? command;
    const exports = buildPosixExportPrefix(env);
    const script = `${exports}exec ${[execCommand, ...args].map(quotePosixShellArg).join(" ")}`;
    return {
      command: getWslCommand(),
      args: [
        "-d",
        location.distro,
        "--cd",
        location.linuxPath,
        "--",
        shellPath,
        "-l",
        "-i",
        "-c",
        script,
      ],
    };
  }

  if (location.kind === "windows") {
    const spec = buildWindowsCommand(location.path, resolvedExecPath ?? command, args);
    if (env && Object.keys(env).length > 0) spec.env = env;
    return spec;
  }

  // location.kind === "posix" (macOS/Linux)
  const spec = buildPosixCommand(location.path, resolvedExecPath ?? command, args);
  if (env && Object.keys(env).length > 0) {
    spec.env = { ...spec.env, ...env };
  }
  return spec;
}

/**
 * Turn an adapter's `AgentArgvSpec` into a platform-ready `CommandSpec`.
 * Resolves an absolute binary path when available (WSL distro lookup, native
 * Windows fallback PATH lookup), wraps through `buildAgentCommand`, and
 * forwards the optional `sessionRef`. Adapters stay free of shell/platform
 * concerns — all branching lives here.
 */
export function resolveLaunchSpec(location: ProjectLocation, argv: AgentArgvSpec): CommandSpec {
  const resolvedExecPath = resolveAgentBinaryPath(location, argv.binary);
  const spec = buildAgentCommand(location, argv.binary, argv.args, resolvedExecPath, argv.env);
  if (argv.sessionRef) {
    spec.sessionRef = argv.sessionRef;
  }
  return spec;
}

// ── Install-detection engine ───────────────────────────────────────

/**
 * Reads an env var on the provider's native side — either WSL (`printf %s
 * "$NAME"` inside the distro so we see the user's login-shell env, not the
 * Windows host env) or the host process's `process.env`.
 * Returns "authenticated" if any listed name is set and non-empty.
 */
export function envVarAuthProbe(names: string[]): AuthProbe {
  return async (ctx) => {
    if (ctx.location.kind === "wsl") {
      const results = await batchWslCommandsAsync(
        ctx.location.distro,
        names.map((n) => `printf %s "$${n}"`),
      );
      const any = results.some((r) => r.ok && r.stdout.trim().length > 0);
      return any ? "authenticated" : "unknown";
    }
    const any = names.some((n) => {
      const value = process.env[n];
      return typeof value === "string" && value.trim().length > 0;
    });
    return any ? "authenticated" : "unknown";
  };
}

/**
 * Existence-check for a config file whose path depends on the environment.
 * Return `undefined` from the resolver to skip the probe (e.g. WSL-only or
 * native-only detection). Returns "authenticated" when the file exists,
 * "missing" when the path resolved but the file is absent.
 */
export function configFileAuthProbe(
  resolvePath: (location: ProjectLocation) => string | undefined,
): AuthProbe {
  return async (ctx) => {
    const path = resolvePath(ctx.location);
    if (!path) return undefined;
    return existsSync(path) ? "authenticated" : "missing";
  };
}

/**
 * Runs the resolved executable with a subcommand (e.g. `["auth", "status"]`)
 * and treats exit-0 as "authenticated", anything else as "unknown". Skipped
 * when the executable itself is missing.
 */
export function cliSubcommandAuthProbe(args: string[]): AuthProbe {
  return async (ctx) => {
    if (!ctx.executablePath) return undefined;
    const spec = buildAgentCommand(ctx.location, ctx.executablePath, args);
    const result = await readCommandOutputAsync(spec.command, spec.args, {
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      ...(spec.env ? { env: spec.env } : {}),
    });
    return result.ok ? "authenticated" : "unknown";
  };
}

const PROBE_WSL_LINUX_PATH = "/tmp";

function detectProbeLocation(ctx: AgentEnvContext | undefined): ProjectLocation {
  if (ctx?.envKind === "wsl" && ctx.wslDistro) {
    return {
      kind: "wsl",
      distro: ctx.wslDistro,
      linuxPath: PROBE_WSL_LINUX_PATH,
      uncPath: "\\\\wsl$",
    };
  }
  if (process.platform === "win32") {
    return { kind: "windows", path: homedir() };
  }
  return { kind: "posix", path: homedir() };
}

async function resolveDetectedBinary(
  ctx: AgentEnvContext | undefined,
  binary: string,
): Promise<string | undefined> {
  if (ctx?.envKind === "wsl" && ctx.wslDistro) {
    const [result] = await batchWslCommandsAsync(ctx.wslDistro, [`command -v ${binary}`]);
    const path = result?.ok ? result.stdout : undefined;
    primeAgentBinaryPath(ctx.wslDistro, binary, path);
    return path;
  }
  return resolveExecutablePathAsync(binary);
}

function extractSemverFromVersionOutput(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b/);
  return match ? match[0] : raw.trim() || undefined;
}

async function readDetectedVersion(
  location: ProjectLocation,
  binary: string,
  executablePath: string | undefined,
  versionArgs: string[],
): Promise<string | undefined> {
  if (!executablePath) return undefined;
  if (location.kind === "wsl") {
    const result = await readWslLoginShellCommandOutputAsync(
      location.distro,
      PROBE_WSL_LINUX_PATH,
      executablePath,
      versionArgs,
    );
    return result.ok ? extractSemverFromVersionOutput(result.stdout) : undefined;
  }
  const spec = buildAgentCommand(location, binary, versionArgs);
  const result = await readCommandOutputAsync(
    spec.command,
    spec.args,
    spec.cwd || spec.env
      ? { ...(spec.cwd ? { cwd: spec.cwd } : {}), ...(spec.env ? { env: spec.env } : {}) }
      : undefined,
  );
  return result.ok ? extractSemverFromVersionOutput(result.stdout) : undefined;
}

// ── Agent command output (native vs WSL) ─────────────────────────────────

/**
 * Run `<executablePath> <args>` against an agent binary and return its
 * stdout/stderr/ok, abstracting the native-vs-WSL fork that detection /
 * session code used to inline. For WSL it routes through the user's login
 * shell (so PATH and profile-loaded helpers like nvm resolve); for native it
 * uses the platform-aware `buildAgentCommand` wrapper.
 */
export async function readAgentCommandOutput(
  location: ProjectLocation,
  executablePath: string,
  args: string[],
  options?: { timeoutMs?: number; wslLinuxCwd?: string },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  if (location.kind === "wsl") {
    return readWslLoginShellCommandOutputAsync(
      location.distro,
      options?.wslLinuxCwd ?? location.linuxPath,
      executablePath,
      args,
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
    );
  }
  const spec = buildAgentCommand(location, executablePath, args);
  return readCommandOutputAsync(
    spec.command,
    spec.args,
    spec.cwd || spec.env
      ? { ...(spec.cwd ? { cwd: spec.cwd } : {}), ...(spec.env ? { env: spec.env } : {}) }
      : undefined,
  );
}

// ── OSC notification helpers (shared across providers) ───────────────────

const OSC_NOTIFICATION_PAYLOAD_KEYS = [
  "event",
  "type",
  "kind",
  "name",
  "notification",
  "id",
] as const;

/**
 * Concatenate the searchable text of an OSC notification, lowercased. Pulls
 * the title, body, the JSON-stringified payload (catches keywords in nested
 * fields like `{ details: { reason: "permission_requested" } }`), and any
 * string fields under common payload keys. Used by codex/opencode for
 * keyword scans like `text.includes("approval")`.
 */
export function getOscNotificationText(notification: OscNotification): string {
  const parts: string[] = [];
  if (notification.title) parts.push(notification.title);
  if (notification.body) parts.push(notification.body);
  const p = notification.payload;
  if (p && typeof p === "object") {
    parts.push(JSON.stringify(p));
    for (const key of OSC_NOTIFICATION_PAYLOAD_KEYS) {
      const value = (p as Record<string, unknown>)[key];
      if (typeof value === "string") parts.push(value);
    }
  }
  return parts.length === 0 ? "" : parts.join("\n").toLowerCase();
}

/**
 * iTerm2 OSC 9;4 progress sub-protocol parser. Body shape: `4;<state>[;<percent>]`.
 *   0 = remove progress  → idle
 *   1 = set progress %   → working
 *   3 = indeterminate    → working (used during a turn)
 *   2 = error / 4 = paused → ignored (no clean status mapping)
 *
 * Used by Claude (which opts in via `preferredNotifChannel: "iterm2"` in the
 * staged settings) and OpenCode (best-effort fallback when hooks miss). Pure
 * function; safe to share via reference.
 */
const ITERM2_PROGRESS_RE = /^4;(\d+)/;
export function iterm2ProgressOscHint(notification: OscNotification): TerminalStatusHint | null {
  if (notification.code !== 9) return null;
  const match = ITERM2_PROGRESS_RE.exec(notification.body);
  if (!match) return null;
  const state = Number(match[1]);
  if (state === 0) return { status: "idle", attention: "none", corroborated: true };
  if (state === 1 || state === 3) {
    return { status: "working", attention: "working", corroborated: true };
  }
  return null;
}

const BRAILLE_OSC_TITLE_PREFIX_RE = /^[⠀-⣿]/;

/**
 * Many TUIs prefix their window/tab title with a braille spinner glyph while
 * a turn is in flight (Claude, Codex, OpenCode). Emit `working` when we see
 * any glyph in the braille block, regardless of the rest of the title.
 */
export function brailleSpinnerOscTitleHint(title: OscTitle): TerminalStatusHint | null {
  if (!BRAILLE_OSC_TITLE_PREFIX_RE.test(title.text)) return null;
  return { status: "working", attention: "working", corroborated: true };
}

/**
 * Shell-integration command boundary hint (OSC 133 and OSC 633 share the same
 * A/B/C/D vocabulary). `command-pre-exec` (`;C`) marks the start of agent
 * execution → working; `command-finished` (`;D`) marks the end → idle. Prompt
 * markers (`;A`/`;B`) are ignored — they fire before/after user input editing
 * and don't represent a status change.
 *
 * Used by GitHub Copilot CLI (OSC 133) as a primary turn-boundary signal,
 * useful especially in WSL where its OSC 9;4 progress emit is unreliable.
 */
export function shellExecOscHint(event: OscShellEvent): TerminalStatusHint | null {
  if (event.kind === "command-pre-exec") {
    return { status: "working", attention: "working", corroborated: true };
  }
  if (event.kind === "command-finished") {
    return { status: "idle", attention: "none", corroborated: true };
  }
  return null;
}

// ── Terminal hint sweeping / config reconciliation ────────────────────────

/**
 * Shape that any provider hint entry must share: a regex + an optional
 * `strong` marker. "Strong" entries are self-corroborating and matched
 * anywhere in the buffer; "weak" entries (e.g. a bare `>` prompt) can be
 * restricted to a tail window via `opts.weakTailWindow` so stale matches
 * from chat scrollback don't outrank the current status indicator.
 */
export interface HintEntry {
  re: RegExp;
  strong?: boolean;
}

export interface FindBestHintOptions {
  weakTailWindow?: number;
}

/**
 * Sweep a list of hint entries across the text and return the entry whose
 * LAST match has the highest index (i.e. the pattern appearing closest to
 * the tail). Replaces the identical-shape `findBestCodexHint` /
 * `findBestHint` (copilot) / Claude's inline loop.
 */
export function findBestHint<T extends HintEntry>(
  text: string,
  entries: readonly T[],
  opts?: FindBestHintOptions,
): T | null {
  const weakWindow = opts?.weakTailWindow;
  const weakStart =
    weakWindow !== undefined && text.length > weakWindow ? text.length - weakWindow : 0;

  let best: { index: number; entry: T } | null = null;
  for (const entry of entries) {
    const globalRe = new RegExp(
      entry.re.source,
      entry.re.flags.includes("g") ? entry.re.flags : entry.re.flags + "g",
    );
    let last: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = globalRe.exec(text)) !== null) {
      if (entry.strong || match.index >= weakStart) {
        last = match;
      }
    }
    if (last && (best === null || last.index > best.index)) {
      best = { index: last.index, entry };
    }
  }
  return best?.entry ?? null;
}

/**
 * Reconcile a `TerminalStatusHint` into a `ThreadConfig`. Returns a new
 * config when any field changed, `undefined` otherwise. This is the exact
 * merge logic that Claude and Copilot had duplicated — consolidated here so
 * new providers get the same semantics for free.
 *
 * Rules:
 * - Enter plan mode when the TUI signals it and config doesn't already agree.
 * - Exit plan mode when TUI no longer signals it AND the turn has landed
 *   (idle, or working after a needs_reply/needs_approval) — this guards
 *   against flicker during a single turn.
 * - Approval policy / model / effort: adopt the hint value when it differs
 *   from the current config.
 */
export function applyTerminalHintToConfig(
  input: SyncConfigFromTerminalStateInput,
): ThreadConfig | undefined {
  let next: ThreadConfig | undefined;

  if (input.hint.planMode && input.config.mode !== "plan") {
    next = { ...(next ?? input.config), mode: "plan" };
  } else if (
    !input.hint.planMode &&
    input.config.mode === "plan" &&
    (input.hint.status === "idle" ||
      (input.hint.status === "working" &&
        (input.previousStatus === "needs_reply" || input.previousStatus === "needs_approval")))
  ) {
    next = { ...(next ?? input.config), mode: undefined };
  }

  if (input.hint.approvalPolicy !== undefined) {
    const currentPolicy = input.config.approvalPolicy ?? "default";
    if (input.hint.approvalPolicy !== currentPolicy) {
      next = { ...(next ?? input.config), approvalPolicy: input.hint.approvalPolicy };
    }
  }

  if (input.hint.model !== undefined && input.hint.model !== input.config.model) {
    next = { ...(next ?? input.config), model: input.hint.model };
  }

  if (input.hint.effort !== undefined && input.hint.effort !== input.config.effort) {
    next = { ...(next ?? input.config), effort: input.hint.effort };
  }

  return next;
}

// ── Session helpers (shared across providers with session-dir watchers) ───

/**
 * Resolve a path inside the user's home directory, correctly across native
 * (`os.homedir()`) and WSL (UNC path against the distro's home, looked up via
 * `resolveWslHomeDirectory`). Returns `undefined` when the WSL home is
 * unavailable. Replaces per-provider platform branching like
 * `~/.codex/sessions` or `~/.gemini/tmp/<project>`.
 */
export function resolveAgentHomeSubpath(
  location: ProjectLocation,
  subpath: string,
): string | undefined {
  if (location.kind === "wsl") {
    const home = resolveWslHomeDirectory(location.distro);
    if (!home) return undefined;
    const trimmed = subpath.replace(/^[\\/]+/, "");
    return toWslUncPath(location.distro, `${home}/${trimmed}`);
  }
  return join(homedir(), ...subpath.split(/[\\/]/).filter((s) => s.length > 0));
}

/**
 * Recursive `fs.watch` wrapper with uniform error-swallow / cleanup semantics.
 * Returns an undo handle or `undefined` when the watcher could not be
 * established (unsupported platform, missing path, etc.). `label` goes into
 * log output so two providers don't have to reimplement the same boilerplate.
 */
export function createRecursiveDirWatcher(
  watchPath: string,
  onChanged: () => void,
  label: string,
): (() => void) | undefined {
  try {
    const watcher = fsWatch(watchPath, { recursive: true }, () => onChanged());
    watcher.on("error", () => {
      try {
        watcher.close();
      } catch {
        // Ignore watcher teardown races.
      }
    });
    console.log("[%s] session watcher active at %s", label, watchPath);
    return () => {
      try {
        watcher.close();
      } catch {
        // Ignore watcher teardown races.
      }
    };
  } catch (error) {
    console.log(
      [
        `[${label}] session watcher unavailable`,
        `  path: ${watchPath}`,
        `  error: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    );
    return undefined;
  }
}

/**
 * Run the shared install-detection flow for an adapter.
 *
 * Steps:
 *   1. Resolve the executable path (WSL `command -v` or native `which`/`where`).
 *      Primes the shared `BinaryResolver` cache so the eventual launch reuses
 *      this lookup instead of probing again.
 *   2. Fetch the version via `spec.versionArgs` (default `["--version"]`).
 *   3. Run `capabilitiesProbe` and merge its partial into `spec.capabilities`.
 *   4. Run `statusProbe` + `capabilitiesProbe` in parallel.
 *   5. Run `authProbes` in order; first `"authenticated"` wins.
 *   6. Assemble the `AgentStatus`.
 */
export async function detectAgentInstall(
  ctx: AgentEnvContext | undefined,
  spec: DetectionSpec,
): Promise<AgentStatus> {
  const location = detectProbeLocation(ctx);
  const executablePath = await resolveDetectedBinary(ctx, spec.binary);

  const versionArgs = spec.versionArgs ?? ["--version"];
  const version = await readDetectedVersion(location, spec.binary, executablePath, versionArgs);

  let capabilities = spec.capabilities;
  let statusProbeResult: StatusProbeResult | undefined;
  if (executablePath) {
    const probeCtx: DetectProbeCtx = { location, executablePath, version };
    const [capabilityPartial, nextStatusProbeResult] = await Promise.all([
      spec.capabilitiesProbe ? spec.capabilitiesProbe(probeCtx) : Promise.resolve(undefined),
      spec.statusProbe ? spec.statusProbe(probeCtx) : Promise.resolve(undefined),
    ]);
    if (capabilityPartial) {
      capabilities = { ...capabilities, ...capabilityPartial };
    }
    statusProbeResult = nextStatusProbeResult;
  }

  let authState: AuthState;
  if (!executablePath) {
    authState = "missing";
  } else {
    authState = statusProbeResult?.authState ?? "unknown";
    const probeCtx: DetectProbeCtx = { location, executablePath, version };
    if (authState !== "authenticated") {
      for (const probe of spec.authProbes ?? []) {
        const result = await probe(probeCtx);
        if (result === "authenticated") {
          authState = "authenticated";
          break;
        }
        if (result !== undefined) {
          authState = result;
        }
      }
    }
  }

  return {
    kind: spec.kind,
    label: spec.label,
    installed: executablePath !== undefined,
    ...(executablePath ? { executablePath } : {}),
    ...(version ? { version } : {}),
    authState,
    ...(statusProbeResult?.providerMetadata
      ? { providerMetadata: statusProbeResult.providerMetadata }
      : {}),
    capabilities,
  };
}

/**
 * @deprecated Use buildAgentCommand() instead. This is kept for backward compatibility.
 */
export function wrapWslCommand(
  location: ProjectLocation,
  command: string,
  args: string[],
  resolvedExecPath?: string,
  env?: Record<string, string>,
): CommandSpec {
  return buildAgentCommand(location, command, args, resolvedExecPath, env);
}

let cachedWindowsSearchPath: string | undefined | null = null;

function getWindowsEnvValue(name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() !== target) continue;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return undefined;
}

function expandWindowsEnvVariables(value: string): string {
  return value.replaceAll(/%([^%]+)%/g, (match, rawName: string) => {
    const resolved = getWindowsEnvValue(rawName);
    return resolved ?? match;
  });
}

function parseWindowsRegistryPath(stdout: string): string | undefined {
  const match = stdout.match(/^\s*Path\s+REG_\w+\s+(.*)$/im);
  const raw = match?.[1]?.trim();
  if (!raw) return undefined;
  return expandWindowsEnvVariables(raw);
}

function readWindowsRegistryPath(scope: "user" | "machine"): string | undefined {
  const key =
    scope === "user"
      ? "HKCU\\Environment"
      : "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
  const result = spawnSync(getWindowsSystemCommand("reg.exe"), ["query", key, "/v", "Path"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return parseWindowsRegistryPath(`${result.stdout ?? ""}`);
}

function splitWindowsPathSegments(pathValue: string | undefined): string[] {
  return (pathValue ?? "")
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function normalizeWindowsPathSegment(segment: string): string {
  return segment.replace(/[\\/]+$/g, "").toLowerCase();
}

function normalizeWindowsPathValue(pathValue: string | undefined): string {
  return splitWindowsPathSegments(pathValue).map(normalizeWindowsPathSegment).join(";");
}

function buildWindowsFallbackPath(): string | undefined {
  if (cachedWindowsSearchPath !== null) {
    return cachedWindowsSearchPath ?? undefined;
  }

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const segment of [
    ...splitWindowsPathSegments(getWindowsEnvValue("Path")),
    ...splitWindowsPathSegments(readWindowsRegistryPath("user")),
    ...splitWindowsPathSegments(readWindowsRegistryPath("machine")),
  ]) {
    const key = normalizeWindowsPathSegment(segment);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    merged.push(segment);
  }

  cachedWindowsSearchPath = merged.length > 0 ? merged.join(";") : undefined;
  return cachedWindowsSearchPath ?? undefined;
}

function buildWindowsPathOverride(): NodeJS.ProcessEnv | undefined {
  const fallbackPath = buildWindowsFallbackPath();
  if (!fallbackPath) return undefined;
  if (
    normalizeWindowsPathValue(fallbackPath) ===
    normalizeWindowsPathValue(getWindowsEnvValue("Path"))
  ) {
    return undefined;
  }
  return {
    ...process.env,
    Path: fallbackPath,
    PATH: fallbackPath,
  };
}

function resolveWindowsExecutablePath(
  command: string,
  env?: NodeJS.ProcessEnv,
): string | undefined {
  const result = spawnSync(getWindowsSystemCommand("where.exe"), [command], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...(env ? { env } : {}),
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return parseCommandOutputLine(`${result.stdout ?? ""}`);
}

export function resolveExecutablePath(command: string): string | undefined {
  if (process.platform === "win32") {
    return (
      resolveWindowsExecutablePath(command) ??
      resolveWindowsExecutablePath(command, buildWindowsPathOverride())
    );
  }

  const result = spawnSync(
    process.env.SHELL || "/bin/bash",
    getPosixLoginShellArgs(`command -v ${quotePosixShellArg(command)}`),
    {
      cwd: homedir(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return parseCommandOutputLine(`${result.stdout ?? ""}`);
}

export function readCommandOutput(
  command: string,
  args: string[],
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    stdout: `${result.stdout ?? ""}`.trim(),
    stderr: `${result.stderr ?? ""}`.trim(),
  };
}

const WSL_BATCH_DELIMITER = "---LIGHTCODE_BATCH_SEP---";
const DEFAULT_WSL_EXEC_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const wslShellPathCache = new Map<string, string>();

function parseCommandOutputLine(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .findLast((line) => line.length > 0);
}

const wslHomeCache = new Map<string, string>();

function buildDirectWslCommandArgs(command: string, args: string[]): string[] {
  if (!command.startsWith("/")) {
    return [command, ...args];
  }

  const slashIndex = command.lastIndexOf("/");
  const binDir = slashIndex > 0 ? command.slice(0, slashIndex) : undefined;
  const pathSegments = [binDir, DEFAULT_WSL_EXEC_PATH].filter((segment): segment is string =>
    Boolean(segment),
  );

  return ["/usr/bin/env", `PATH=${pathSegments.join(":")}`, command, ...args];
}

export function resolveWslShellPath(distro: string): string {
  const cached = wslShellPathCache.get(distro);
  if (cached) {
    return cached;
  }

  try {
    const result = spawnSync(
      getWslCommand(),
      ["-d", distro, "--", "sh", "-lc", 'getent passwd "$(id -un)" | cut -d: -f7'],
      {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 3_000,
      },
    );
    if (!result.error && result.status === 0) {
      const shellPath = parseCommandOutputLine(`${result.stdout ?? ""}`);
      if (shellPath) {
        wslShellPathCache.set(distro, shellPath);
        return shellPath;
      }
    }
  } catch {
    // Fall through to bash so rc files (nvm/fnm/asdf) still get sourced.
  }

  const fallback = "/bin/bash";
  wslShellPathCache.set(distro, fallback);
  return fallback;
}

export async function resolveWslShellPathAsync(distro: string): Promise<string> {
  const cached = wslShellPathCache.get(distro);
  if (cached) {
    return cached;
  }

  try {
    const { stdout } = await execFileAsync(
      getWslCommand(),
      ["-d", distro, "--", "sh", "-lc", 'getent passwd "$(id -un)" | cut -d: -f7'],
      {
        windowsHide: true,
        timeout: 3_000,
      },
    );
    const shellPath = parseCommandOutputLine(stdout ?? "");
    if (shellPath) {
      wslShellPathCache.set(distro, shellPath);
      return shellPath;
    }
  } catch {
    // Fall through to bash so rc files (nvm/fnm/asdf) still get sourced.
  }

  const fallback = "/bin/bash";
  wslShellPathCache.set(distro, fallback);
  return fallback;
}

export function buildBatchWslScript(commands: string[], sep = WSL_BATCH_DELIMITER): string {
  return commands.map((cmd) => `(${cmd}) 2>/dev/null; echo "${sep}"`).join("\n");
}

/**
 * Run multiple commands in a single `wsl.exe` invocation, splitting output
 * by a known delimiter.  This avoids the ~800-1000ms per-invocation overhead
 * of spawning separate `wsl.exe` processes.
 */
export function batchWslCommands(
  distro: string,
  commands: string[],
): { ok: boolean; stdout: string }[] {
  const sep = WSL_BATCH_DELIMITER;
  const script = buildBatchWslScript(commands, sep);
  const result = spawnSync(
    getWslCommand(),
    ["-d", distro, "--", resolveWslShellPath(distro), "-l", "-i", "-c", script],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 15_000,
    },
  );
  if (result.error || result.status !== 0) {
    return commands.map(() => ({ ok: false, stdout: "" }));
  }
  const parts = (result.stdout ?? "").split(sep);
  return commands.map((_, i) => {
    const raw = (parts[i] ?? "").trim();
    return { ok: raw.length > 0, stdout: raw };
  });
}

export function resolveWslExecutablePath(distro: string, command: string): string | undefined {
  const result = spawnSync(
    getWslCommand(),
    ["-d", distro, "--", resolveWslShellPath(distro), "-l", "-i", "-c", `command -v ${command}`],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return parseCommandOutputLine(`${result.stdout ?? ""}`);
}

export function resolveWslHomeDirectory(distro: string): string | undefined {
  const cached = wslHomeCache.get(distro);
  if (cached) {
    return cached;
  }

  const result = spawnSync(
    getWslCommand(),
    ["-d", distro, "--", "sh", "-lc", 'printf %s "$HOME"'],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 5_000,
    },
  );
  if (result.error || result.status !== 0) {
    return undefined;
  }
  const home = parseCommandOutputLine(`${result.stdout ?? ""}`);
  if (home) {
    wslHomeCache.set(distro, home);
  }
  return home;
}

export function readWslCommandOutput(
  distro: string,
  command: string,
  args: string[],
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(
    getWslCommand(),
    ["-d", distro, "--", ...buildDirectWslCommandArgs(command, args)],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  return {
    ok: result.status === 0,
    stdout: `${result.stdout ?? ""}`.trim(),
    stderr: `${result.stderr ?? ""}`.trim(),
  };
}

// ── Async (non-blocking) variants for agent detection ──────────────
// These use execFile instead of spawnSync so the event loop stays free
// for IPC messages (git status, thread snapshots, etc.) during detection.

const execPathCache = new Map<string, { path: string | undefined; ts: number }>();
const EXEC_CACHE_TTL_MS = 60_000;

/**
 * Full env captured from the user's login shell during `primeExecutablePathCache`.
 * Lets `buildPosixCommand` spawn absolute binaries directly while preserving
 * the user's shell env (PATH, NVM_DIR, HOMEBREW_PREFIX, EDITOR, LANG, custom
 * exports like OPENAI_API_KEY, etc.). Without it, Electron-from-Finder spawns
 * inherit only launchd's skeleton env and tools relying on user-set vars
 * silently break.
 */
let primedPosixEnv: Record<string, string> | undefined;

/** Shell-internal / per-process vars that must not leak into spawned children. */
const PRIMED_ENV_SKIP = new Set([
  "PWD",
  "OLDPWD",
  "SHLVL",
  "_",
  "OPTIND",
  "LINENO",
  "PS1",
  "PS2",
  "PROMPT",
]);

export function clearExecutablePathCache(): void {
  execPathCache.clear();
  cachedWindowsSearchPath = null;
  primedPosixEnv = undefined;
  clearProjectNodeBinCache();
}

/** Sync read of the cached binary path. Returns undefined if absent or stale. */
export function getCachedExecutablePath(command: string): string | undefined {
  const cached = execPathCache.get(command);
  if (!cached) return undefined;
  if (Date.now() - cached.ts > EXEC_CACHE_TTL_MS) return undefined;
  return cached.path;
}

/** Env captured from the user's login shell during prime; undefined until then. */
export function getPrimedPosixEnv(): Record<string, string> | undefined {
  return primedPosixEnv;
}

const PRIMED_ENV_MARKER = "__LIGHTCODE_ENV_BEGIN__";
/** Matches a line that opens a new exported var: `NAME=value`. */
const PRIMED_ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Parse the trailing `env` dump emitted by the prime script. `env` outputs one
 * `KEY=VALUE` per line; values containing newlines wrap onto continuation
 * lines that don't match the `KEY=` shape. Recover those by appending until we
 * hit the next assignment.
 */
function parsePrimedEnvDump(lines: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  let currentKey: string | undefined;
  for (const line of lines) {
    const match = PRIMED_ENV_VAR_RE.exec(line);
    if (match) {
      const [, key, value] = match;
      if (PRIMED_ENV_SKIP.has(key!)) {
        currentKey = undefined;
        continue;
      }
      env[key!] = value!;
      currentKey = key;
    } else if (currentKey !== undefined) {
      env[currentKey] = `${env[currentKey] ?? ""}\n${line}`;
    }
  }
  return env;
}

/**
 * Resolve multiple binary paths through a single login shell invocation and
 * prime the per-command cache. Detection runs N parallel adapters, each of
 * which would otherwise spawn its own `zsh -l -i -c command -v <bin>` — on
 * macOS GUI launches that means N cold interactive shells (nvm + oh-my-zsh +
 * starship + plugins ≈ 2-3s each), and the parallel load pushes individual
 * probes past the 5s timeout, leaving random subsets marked as missing.
 *
 * One shell, N lookups: the slow shell startup is paid once, every subsequent
 * `resolveExecutablePathAsync(cmd)` for a primed name returns from cache.
 * The same call also captures the full shell env so later spawns can skip
 * the login-shell wrapper without losing user-set exports.
 *
 * Windows is skipped — `where.exe` is fast and doesn't pay the shell cost.
 */
export async function primeExecutablePathCache(commands: readonly string[]): Promise<void> {
  if (process.platform === "win32" || commands.length === 0) {
    return;
  }
  const unique = [...new Set(commands)];
  // After the binary lookups, dump the full env so direct-spawn calls inherit
  // PATH, NVM_DIR, HOMEBREW_PREFIX, EDITOR, custom exports, etc. — same as a
  // process started from the user's terminal.
  const probeLines = [
    ...unique.map(
      (cmd) =>
        `printf '%s\\t' ${quotePosixShellArg(cmd)}; command -v ${quotePosixShellArg(cmd)} 2>/dev/null || true; printf '\\n'`,
    ),
    `printf '%s\\n' ${quotePosixShellArg(PRIMED_ENV_MARKER)}`,
    `env`,
  ];
  const script = probeLines.join("; ");
  try {
    const { stdout } = await execFileAsync(
      process.env.SHELL || "/bin/bash",
      getPosixLoginShellArgs(script),
      {
        cwd: homedir(),
        windowsHide: true,
        timeout: 15_000,
      },
    );
    const ts = Date.now();
    const allLines = (stdout ?? "").split(/\r?\n/g);
    const markerIdx = allLines.indexOf(PRIMED_ENV_MARKER);
    const lookupLines = markerIdx >= 0 ? allLines.slice(0, markerIdx) : allLines;
    const envLines = markerIdx >= 0 ? allLines.slice(markerIdx + 1) : [];

    const resolved = new Map<string, string | undefined>();
    for (const line of lookupLines) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const name = line.slice(0, tab);
      const value = line.slice(tab + 1).trim();
      resolved.set(name, value.length > 0 ? value : undefined);
    }
    for (const cmd of unique) {
      execPathCache.set(cmd, { path: resolved.get(cmd), ts });
    }

    if (envLines.length > 0) {
      const parsed = parsePrimedEnvDump(envLines);
      if (Object.keys(parsed).length > 0) {
        primedPosixEnv = parsed;
      }
    }
  } catch {
    // Leave cache untouched on failure; per-binary fallback paths still run.
  }
}

export async function resolveExecutablePathAsync(command: string): Promise<string | undefined> {
  const cached = execPathCache.get(command);
  if (cached && Date.now() - cached.ts < EXEC_CACHE_TTL_MS) {
    return cached.path;
  }

  try {
    const resolved =
      process.platform === "win32"
        ? ((await (async () => {
            try {
              const ambient = parseCommandOutputLine(
                (
                  await execFileAsync(getWindowsSystemCommand("where.exe"), [command], {
                    windowsHide: true,
                    timeout: 5_000,
                  })
                ).stdout ?? "",
              );
              if (ambient) return ambient;
            } catch {
              // Fall through to the registry-backed PATH override below.
            }
            const env = buildWindowsPathOverride();
            if (!env) return undefined;
            try {
              return parseCommandOutputLine(
                (
                  await execFileAsync(getWindowsSystemCommand("where.exe"), [command], {
                    env,
                    windowsHide: true,
                    timeout: 5_000,
                  })
                ).stdout ?? "",
              );
            } catch {
              return undefined;
            }
          })()) ?? undefined)
        : parseCommandOutputLine(
            (
              await execFileAsync(
                process.env.SHELL || "/bin/bash",
                getPosixLoginShellArgs(`command -v ${quotePosixShellArg(command)}`),
                {
                  cwd: homedir(),
                  windowsHide: true,
                  timeout: 5_000,
                },
              )
            ).stdout ?? "",
          );
    execPathCache.set(command, { path: resolved, ts: Date.now() });
    return resolved;
  } catch {
    execPathCache.set(command, { path: undefined, ts: Date.now() });
    return undefined;
  }
}

export async function readCommandOutputAsync(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      timeout: 10_000,
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.env ? { env: { ...process.env, ...options.env } } : {}),
    });
    return { ok: true, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string } | undefined;
    return {
      ok: false,
      stdout: (err?.stdout ?? "").trim(),
      stderr: (err?.stderr ?? "").trim(),
    };
  }
}

export async function batchWslCommandsAsync(
  distro: string,
  commands: string[],
): Promise<{ ok: boolean; stdout: string }[]> {
  const sep = WSL_BATCH_DELIMITER;
  const script = buildBatchWslScript(commands, sep);
  try {
    const shellPath = await resolveWslShellPathAsync(distro);
    // Always source the user's rc files (`-l -i`) so detection sees the
    // same PATH the user gets in their terminal — fnm/nvm/asdf shims, npm
    // global bin dirs, etc. A captured PATH from a non-tty `-l -i` shell
    // is unreliable (rc files often gate PATH additions on `[ -t 0 ]`),
    // and detection silently dropping codex/gemini/opencode is worse than
    // paying the rc-sourcing cost on every probe.
    const { stdout } = await execFileAsync(
      getWslCommand(),
      ["-d", distro, "--", shellPath, "-l", "-i", "-c", script],
      {
        windowsHide: true,
        timeout: 15_000,
      },
    );
    const parts = (stdout ?? "").split(sep);
    return commands.map((_, i) => {
      const raw = (parts[i] ?? "").trim();
      return { ok: raw.length > 0, stdout: raw };
    });
  } catch {
    return commands.map(() => ({ ok: false, stdout: "" }));
  }
}

/**
 * Run multiple shell commands **in parallel** inside a single `wsl.exe` spawn.
 * Each command's stdout is captured to a tempfile, then all are emitted in
 * order with a delimiter between them. Saves N×bash-init overhead vs spawning
 * N separate wsl.exe processes, *and* runs commands concurrently inside the
 * distro. Best for refresh-style "do several independent git/gh calls and
 * collect all outputs" patterns.
 *
 * The script is piped to bash via stdin (not `-c`) because `wsl.exe`
 * pre-expands `$VAR` and `$(...)` in its argv before forwarding to the target
 * binary, which would corrupt our use of `$T` / `$?` / `$(mktemp)`. stdin
 * forwards bytes verbatim.
 */
export async function parallelWslCommandsAsync(
  distro: string,
  commands: { cwd?: string; cmd: string }[],
  options?: { timeoutMs?: number },
): Promise<{ ok: boolean; stdout: string; exitCode: number }[]> {
  const sep = WSL_BATCH_DELIMITER;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const script = buildParallelWslScript(commands, sep);
  try {
    const shellPath = await resolveWslShellPathAsync(distro);
    // Always run under `-l` so ~/.profile sources the user's PATH (git, gh,
    // npm-global bins). Mirrors the always-login-shell rule applied to PTY
    // launches and detection probes.
    const wslArgs = ["-d", distro, "--", shellPath, "-l"];
    const stdout = await runWslScriptViaStdin(wslArgs, script, timeoutMs);
    return parseParallelWslOutput(stdout, commands.length, sep);
  } catch {
    return commands.map(() => ({ ok: false, stdout: "", exitCode: 1 }));
  }
}

function runWslScriptViaStdin(
  wslArgs: string[],
  script: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(getWslCommand(), wslArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 50 * 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("wsl batch timed out"));
      if (code !== 0 && stdout.length === 0) {
        return reject(new Error(`wsl batch exited ${code}: ${stderr.trim()}`));
      }
      resolve(stdout);
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

function buildParallelWslScript(commands: { cwd?: string; cmd: string }[], sep: string): string {
  const launchers = commands
    .map((c, i) => {
      const cwdPrefix = c.cwd ? `cd ${quotePosixShellArg(c.cwd)} && ` : "";
      // Each cmd writes stdout to its own tempfile and exit code to a sibling
      // file. stderr is silenced — git prints noise on success too.
      return `(${cwdPrefix}${c.cmd}) >"$T/${i}.out" 2>/dev/null; echo $? >"$T/${i}.rc" &`;
    })
    .join("\n");
  const emitters = commands
    .map(
      (_, i) =>
        `printf '%s\\n' "$(cat "$T/${i}.out")"; printf '\\n${sep}\\n%s\\n${sep}\\n' "$(cat "$T/${i}.rc")"`,
    )
    .join("\n");
  return [
    // Suppress git's optional `.git/index` stat-cache refresh: read-only ops
    // (status, diff) won't write the index and so won't fire `.git/index`
    // watcher events that would trigger a refresh→write→refresh loop.
    `export GIT_OPTIONAL_LOCKS=0`,
    `T=$(mktemp -d)`,
    `trap 'rm -rf "$T"' EXIT`,
    launchers,
    `wait`,
    emitters,
  ].join("\n");
}

function parseParallelWslOutput(
  stdout: string,
  count: number,
  sep: string,
): { ok: boolean; stdout: string; exitCode: number }[] {
  const parts = stdout.split(sep);
  const result: { ok: boolean; stdout: string; exitCode: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const out = (parts[i * 2] ?? "").replace(/^\n+|\n+$/g, "");
    const rcStr = (parts[i * 2 + 1] ?? "").trim();
    const exitCode = parseInt(rcStr, 10);
    result.push({
      ok: Number.isFinite(exitCode) && exitCode === 0,
      stdout: out,
      exitCode: Number.isFinite(exitCode) ? exitCode : 1,
    });
  }
  return result;
}

export async function readWslCommandOutputAsync(
  distro: string,
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      getWslCommand(),
      [
        "-d",
        distro,
        ...(options?.cwd ? ["--cd", options.cwd] : []),
        "--",
        ...buildDirectWslCommandArgs(command, args),
      ],
      {
        windowsHide: true,
        timeout: 10_000,
      },
    );
    return { ok: true, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string } | undefined;
    return {
      ok: false,
      stdout: (err?.stdout ?? "").trim(),
      stderr: (err?.stderr ?? "").trim(),
    };
  }
}

export async function readWslLoginShellCommandOutputAsync(
  distro: string,
  linuxCwd: string,
  command: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number; env?: Record<string, string> },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const spec = buildAgentCommand(
    {
      kind: "wsl",
      distro,
      linuxPath: linuxCwd,
      uncPath: `\\\\wsl.localhost\\${distro}${linuxCwd.replace(/\//g, "\\")}`,
    },
    command,
    args,
    undefined,
    options?.env,
  );

  try {
    const { stdout, stderr } = await execFileAsync(spec.command, spec.args, {
      windowsHide: true,
      timeout: options?.timeout ?? 10_000,
      ...(options?.maxBuffer ? { maxBuffer: options.maxBuffer } : {}),
    });
    return { ok: true, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string } | undefined;
    return {
      ok: false,
      stdout: (err?.stdout ?? "").trim(),
      stderr: (err?.stderr ?? "").trim(),
    };
  }
}

/**
 * Execute a command inside WSL and return stdout.
 * Uses direct invocation (no intermediate shell) — arguments are passed as
 * discrete argv entries through `wsl.exe`, preserving special characters.
 * Throws on non-zero exit with stderr in the error message.
 */
export async function execInWsl(
  distro: string,
  linuxCwd: string,
  command: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const { stdout } = await execFileAsync(
    getWslCommand(),
    ["-d", distro, "--cd", linuxCwd, "--", command, ...args],
    {
      windowsHide: true,
      timeout: options?.timeout ?? 10_000,
      ...(options?.maxBuffer ? { maxBuffer: options.maxBuffer } : {}),
      ...(options?.env ? { env: options.env } : {}),
    },
  );
  return stdout;
}

export async function resolveWslHomeDirectoryAsync(distro: string): Promise<string | undefined> {
  const cached = wslHomeCache.get(distro);
  if (cached) {
    return cached;
  }

  const result = await readWslCommandOutputAsync(distro, "sh", ["-lc", 'printf %s "$HOME"']);
  const home = result.ok ? result.stdout.trim() : "";
  if (!home) {
    return undefined;
  }
  wslHomeCache.set(distro, home);
  return home;
}

/**
 * Default segment formatter: file segments become `@path`, text segments pass through.
 * Used when an adapter doesn't implement `formatPromptSegments`.
 */
export function shortenHomePath(p: string): string {
  const normalized = p.replaceAll("\\", "/");
  const homeNorm = homedir().replaceAll("\\", "/");
  if (normalized.startsWith(homeNorm + "/")) {
    return "~" + normalized.slice(homeNorm.length);
  }
  // Also shorten Linux home paths for WSL sessions
  return normalized.replace(/^\/home\/[^/]+\//, "~/").replace(/^\/root\//, "~/");
}

export function defaultFormatPromptSegments(segments: PromptSegment[]): string {
  const attachments = segments.filter((s) => s.kind === "attachment");
  const rest = segments.filter((s) => s.kind !== "attachment");
  const attachmentLines = attachments.map((s) => `@${shortenHomePath(s.path)}`).join(" ");
  const restStr = rest.map((s) => (s.kind === "file" ? `@${s.path}` : s.content)).join("");
  return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
}

export function detectAuthFile(filePath: string): AuthState {
  return existsSync(filePath) ? "authenticated" : "missing";
}

export function createKnownSessionRef(sessionId?: string): SessionRef {
  return {
    providerSessionId: sessionId ?? randomUUID(),
    discoveredAt: new Date().toISOString(),
  };
}
