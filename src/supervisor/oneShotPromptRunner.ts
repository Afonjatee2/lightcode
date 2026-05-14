import type { ProjectLocation } from "@/shared/contracts";
import type { AgentAdapter, CommandSpec } from "./agents/base";
import { buildOneShotSpec, spawnAgent } from "./oneShotSpawn";

// Spawn returns these errno codes when the OS rejects the argv length:
// - ENAMETOOLONG: macOS / Windows (via libuv mapping)
// - E2BIG: Linux execve when argv+envp exceeds ARG_MAX
const ARGV_TOO_LONG_CODES: ReadonlySet<string> = new Set(["ENAMETOOLONG", "E2BIG"]);

// Conservative per-platform argv budgets — slightly under the OS hard caps so
// the shell-wrapping overhead (`bash -l -i -c '<…>'`, `wsl.exe -d <distro> --`)
// still fits.
//   Windows: CreateProcess command line ≤ 32_767 chars total.
//   Linux:   MAX_ARG_STRLEN ≤ 131_072 per *single* argv (binding when the
//            whole command is wrapped into one `bash -c '…'` arg).
//   macOS:   ARG_MAX ≈ 262_144 (total argv + envp).
function platformArgvBudgets(): { totalChars: number; perArgChars: number } {
  if (process.platform === "win32") return { totalChars: 28_000, perArgChars: 28_000 };
  if (process.platform === "darwin") return { totalChars: 220_000, perArgChars: 220_000 };
  return { totalChars: 1_500_000, perArgChars: 110_000 };
}

export function isArgvLikelyTooLong(spec: CommandSpec): boolean {
  const { totalChars, perArgChars } = platformArgvBudgets();
  let total = spec.command.length;
  let maxArg = spec.command.length;
  for (const arg of spec.args) {
    total += arg.length + 1;
    if (arg.length > maxArg) maxArg = arg.length;
  }
  return total > totalChars || maxArg > perArgChars;
}

export function isArgvTooLongError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string" && ARGV_TOO_LONG_CODES.has(candidate.code)) {
    return true;
  }
  if (typeof candidate.message === "string") {
    for (const code of ARGV_TOO_LONG_CODES) {
      if (candidate.message.includes(code)) return true;
    }
  }
  return false;
}

/** One attempt in the fallback chain; later attempts should yield smaller prompts. */
export interface OneShotPromptAttempt {
  /** Short tag for logs (e.g. "full", "files-only", "scrollback-30k"). */
  level: string;
  /** Build the prompt for this attempt. Called lazily — only when the attempt fires. */
  buildPrompt(): string;
}

export interface RunOneShotPromptOptions {
  location: ProjectLocation;
  adapter: AgentAdapter;
  model: string;
  effort: string | undefined;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Tag for log lines, e.g. "commit-gen", "pr-summary-gen". */
  logTag: string;
  /** Ordered prompt builders; tried in sequence, smallest last. Must be non-empty. */
  attempts: readonly OneShotPromptAttempt[];
}

/**
 * Run a one-shot LLM call with progressive prompt fallback.
 *
 * Adapters that embed the prompt in argv (Claude/OpenCode/Gemini/Copilot via `-p`)
 * blow past OS argv caps for large diffs / scrollbacks, surfacing as `spawn
 * ENAMETOOLONG` (or `E2BIG` on Linux). This helper retries with the next smaller
 * prompt on detected argv overflow, and also skips proactively when the built
 * `CommandSpec` is already over the platform budget — so we don't waste a
 * doomed spawn before falling back.
 */
export async function runOneShotPromptWithFallback(
  options: RunOneShotPromptOptions,
): Promise<string> {
  if (!options.adapter.buildOneShotCommand) {
    throw new Error(`${options.adapter.label} does not support one-shot generation`);
  }
  if (options.attempts.length === 0) {
    throw new Error("runOneShotPromptWithFallback: no attempts provided");
  }

  let lastError: unknown;
  for (let i = 0; i < options.attempts.length; i++) {
    const attempt = options.attempts[i]!;
    const prompt = attempt.buildPrompt();
    const cmd = options.adapter.buildOneShotCommand(options.model, options.effort, prompt);
    if (!cmd) {
      throw new Error(`${options.adapter.label} does not support one-shot generation`);
    }
    const spawnSpec = buildOneShotSpec(options.location, cmd.command, cmd.args);
    const hasNextAttempt = i < options.attempts.length - 1;

    if (hasNextAttempt && isArgvLikelyTooLong(spawnSpec)) {
      console.warn(
        `[${options.logTag}] skipping ${attempt.level} (argv ~${argvCharCount(spawnSpec)} chars over platform budget); trying ${options.attempts[i + 1]!.level}`,
      );
      continue;
    }

    console.log(
      `[${options.logTag}] spawning ${attempt.level}: ${spawnSpec.command} (${spawnSpec.args.length} args, prompt ${prompt.length} chars)`,
    );

    try {
      return await spawnAgent(spawnSpec, cmd.stdin ?? prompt, options.timeoutMs, options.signal);
    } catch (err) {
      lastError = err;
      if (hasNextAttempt && isArgvTooLongError(err)) {
        console.warn(
          `[${options.logTag}] argv too long at ${attempt.level} for ${options.adapter.label}; retrying with ${options.attempts[i + 1]!.level}`,
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error(`[${options.logTag}] all fallback attempts exhausted`);
}

function argvCharCount(spec: CommandSpec): number {
  let total = spec.command.length;
  for (const arg of spec.args) total += arg.length + 1;
  return total;
}
