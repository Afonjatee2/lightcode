/**
 * CLI-backed one-shot text generation for codex (commit / PR / title / spec).
 *
 * `codex exec` prints the WHOLE session transcript to stdout — banner, echoed
 * prompt, and tool-use narration — not just the answer. To capture only the
 * final assistant message we pass `--output-last-message <file>`, which makes
 * codex write the last message to a temp file that we read back. If the file is
 * unavailable (older codex without the flag, or a WSL UNC read failure) we fall
 * back to recovering the final message from the transcript itself.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import { toWslUncPath } from "@/shared/wsl";
import { extractFinalAgentMessage } from "../../agentTranscript";
import { prepareOneShot } from "../../oneShotSpawn";
import { batchWslCommandsAsync, type RunOneShotInput } from "../base";

// The real deadline rides in on `input.signal` (the runner folds its timeout
// into the signal); this is only a backstop so a wedged CLI can't hang forever.
const ONE_SHOT_BACKSTOP_TIMEOUT_MS = 600_000;

/**
 * Build the `codex exec` argv for a one-shot. The prompt always arrives on
 * stdin (the trailing `-`), so argv stays tiny regardless of prompt size. When
 * `lastMessagePath` is supplied, codex also writes its final message there.
 */
export function buildCodexOneShotArgs(
  model: string,
  effort: string | undefined,
  lastMessagePath?: string,
): string[] {
  // `--skip-git-repo-check` lets `codex exec` run from worktrees or other
  // directories not on codex's trust list. One-shots only read the user's
  // prompt from stdin and emit a short string, so the trust gate is just noise.
  const args = ["exec", "--skip-git-repo-check", "-m", model];
  if (lastMessagePath) {
    args.push("--output-last-message", lastMessagePath);
  }
  if (effort) {
    args.push("-c", `model_reasoning_effort="${effort}"`);
  }
  args.push("-");
  return args;
}

interface LastMessagePlan {
  /** Path passed to `--output-last-message` (a Linux path inside WSL). */
  cliPath: string;
  /** Path the supervisor reads the file back from (a UNC path for WSL). */
  readPath: string;
}

function planLastMessageFile(location: ProjectLocation): LastMessagePlan {
  const nonce = randomBytes(8).toString("hex");
  if (location.kind === "wsl") {
    const cliPath = `/tmp/codex-oneshot-${nonce}.md`;
    return { cliPath, readPath: toWslUncPath(location.distro, cliPath) };
  }
  const nativePath = join(tmpdir(), `codex-oneshot-${nonce}.md`);
  return { cliPath: nativePath, readPath: nativePath };
}

function removeLastMessageFile(location: ProjectLocation, plan: LastMessagePlan): void {
  try {
    if (location.kind === "wsl") {
      // The file lives in the distro's /tmp; remove it through a login-shell
      // `rm`. The nonce path is shell-safe, so no quoting is needed. Best-effort
      // — /tmp is ephemeral even if this never lands.
      void batchWslCommandsAsync(location.distro, [`rm -f ${plan.cliPath}`]);
    } else {
      unlinkSync(plan.readPath);
    }
  } catch {
    // Temp-file cleanup is best-effort.
  }
}

/**
 * Run a one-shot prompt through `codex exec`, returning only codex's final
 * assistant message. Honours `input.signal` for cancellation (forwarded to the
 * spawn).
 */
export async function runCodexOneShot(input: RunOneShotInput): Promise<string> {
  const plan = planLastMessageFile(input.location);
  const args = buildCodexOneShotArgs(input.model, input.effort, plan.cliPath);
  const { spec, spawn } = prepareOneShot(input.location, { command: "codex", args });
  const transcript = await spawn(spec, input.prompt, ONE_SHOT_BACKSTOP_TIMEOUT_MS, input.signal);

  try {
    const lastMessage = readFileSync(plan.readPath, "utf8").trim();
    if (lastMessage.length > 0) {
      return lastMessage;
    }
  } catch {
    // Fall through to transcript extraction below.
  } finally {
    removeLastMessageFile(input.location, plan);
  }

  // The CLI did not honour --output-last-message (or the file could not be
  // read) — recover the final assistant message from the transcript so callers
  // still get a clean reply instead of the whole session.
  return extractFinalAgentMessage(transcript);
}
