import type { ThreadConfig } from "@/shared/contracts";

// `opencode` (default TUI) only accepts `[project]` as a positional, so the
// initial prompt must go through `--prompt` rather than a trailing arg.
// `buildDirectInput` handles all subsequent prompts after the TUI is up.
export function buildOpenCodeArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = [];

  if (resumeSessionId) {
    args.push("--session", resumeSessionId);
  }
  if (config.model) {
    args.push("--model", config.model);
  }
  if (prompt.trim().length > 0) {
    args.push("--prompt", prompt);
  }
  return args;
}
