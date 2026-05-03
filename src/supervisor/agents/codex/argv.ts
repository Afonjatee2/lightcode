import type { ProjectLocation, SessionRef, ThreadConfig } from "@/shared/contracts";
import {
  buildAgentCommand,
  type AgentArgvSpec,
  type AgentLaunchOptions,
  type CommandSpec,
} from "../base";

export const CODEX_REMOTE_TUI_FEATURE = "tui_app_server";

function buildCodexArgs(
  config: ThreadConfig,
  prompt: string,
  launchOptions?: AgentLaunchOptions,
): string[] {
  const args: string[] = [];

  for (const feature of launchOptions?.enabledFeatures ?? []) {
    args.push("--enable", feature);
  }

  if (launchOptions?.remoteUrl) {
    args.push("--remote", launchOptions.remoteUrl);
  }

  args.push("--no-alt-screen");

  // OSC 9 TUI notifications — L2 status when hooks are unavailable (always-on).
  // `tui.notifications = true` enables all notification event types; array = allowlist only.
  args.push(
    "-c",
    "tui.notifications=true",
    "-c",
    'tui.notification_method="osc9"',
    "-c",
    "suppress_unstable_features_warning=true",
  );

  if (!launchOptions?.suppressResumeConfigOverrides) {
    if (config.model) {
      args.push("-m", config.model);
    }
    if (config.effort) {
      args.push("-c", `model_reasoning_effort="${config.effort}"`);
    }
    if (config.fast) {
      // Codex's `service_tier="fast"` selects the priority lane on supported models.
      args.push("-c", 'service_tier="fast"');
    }
    if (config.approvalPolicy) {
      args.push("-a", config.approvalPolicy);
    }
    if (config.sandboxMode) {
      args.push("-s", config.sandboxMode);
    }
  }

  if (prompt.trim().length > 0) {
    args.push(prompt);
  }
  return args;
}

export function buildCodexArgvFor(
  config: ThreadConfig,
  prompt: string,
  sessionRef?: SessionRef,
  launchOptions?: AgentLaunchOptions,
): AgentArgvSpec {
  // When the structured session owns thread lifecycle, the TUI resumes the
  // server-created thread. Config is controlled by the server, not the CLI.
  if (launchOptions?.suppressResumeConfigOverrides) {
    const baseArgs = buildCodexArgs(config, "", launchOptions);
    const args = launchOptions.resumeThreadId
      ? [
          "resume",
          ...baseArgs,
          launchOptions.resumeThreadId,
          ...(prompt.trim().length > 0 ? [prompt] : []),
        ]
      : baseArgs;
    return { binary: "codex", args };
  }

  const codexArgs = buildCodexArgs(config, prompt, launchOptions);
  const args = sessionRef
    ? [
        "resume",
        ...buildCodexArgs(config, "", launchOptions),
        sessionRef.providerSessionId,
        ...(prompt.trim().length > 0 ? [prompt] : []),
      ]
    : codexArgs;

  return { binary: "codex", args };
}

export function buildCodexAppServerCommand(
  location: ProjectLocation,
  remoteUrl: string,
  wslExecPath?: string,
): CommandSpec {
  const args = ["app-server", "--listen", remoteUrl, "--enable", CODEX_REMOTE_TUI_FEATURE];
  return buildAgentCommand(location, "codex", args, wslExecPath);
}
