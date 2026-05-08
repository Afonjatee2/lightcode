import { dirname as posixDirname } from "node:path/posix";
import type { ProjectLocation, ThreadConfig } from "@/shared/contracts";
import { buildAgentCommand, getWslCommand, type CommandSpec } from "../base";

const DEFAULT_WSL_EXEC_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

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
  // OpenCode's `--variant` flag matches its SDK `variant` field — used to
  // pick provider-specific reasoning effort (high, max, minimal, …) for
  // models that publish a `variants` map in `opencode models --verbose`.
  if (config.effort && config.effort.length > 0) {
    args.push("--variant", config.effort);
  }
  // Plan mode in the TUI is just the built-in `plan` agent (`opencode agent
  // list`). The default command accepts `--agent <name>` to pick it at
  // launch; the SDK runtime uses the same value via `prompt_async`.
  if (config.mode === "plan") {
    args.push("--agent", "plan");
  }
  if (prompt.trim().length > 0) {
    args.push("--prompt", prompt);
  }
  return args;
}

// Background `opencode serve` does not need rc init (no nvm/fnm shims to load),
// so we mirror Codex's `buildCodexAppServerCommand`: bypass `bash -l -i` and
// invoke the binary under `/usr/bin/env PATH=<segments>` instead. The TUI
// launch keeps its login-shell wrapping (via `buildAgentCommand` in the
// adapter's `buildLaunchArgv`).
export function buildOpenCodeServerCommand(
  location: ProjectLocation,
  wslExecPath?: string,
): CommandSpec {
  const args = ["serve", "--hostname=127.0.0.1", "--port=0", "--print-logs"];
  if (location.kind === "wsl") {
    const pathSegments = [
      wslExecPath?.startsWith("/") ? posixDirname(wslExecPath) : undefined,
      DEFAULT_WSL_EXEC_PATH,
    ].filter((segment): segment is string => Boolean(segment));
    return {
      command: getWslCommand(),
      args: [
        "-d",
        location.distro,
        "--cd",
        location.linuxPath,
        "--",
        "/usr/bin/env",
        `PATH=${pathSegments.join(":")}`,
        wslExecPath ?? "opencode",
        ...args,
      ],
    };
  }
  return buildAgentCommand(location, "opencode", args, wslExecPath);
}
