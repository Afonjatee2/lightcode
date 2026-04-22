import type { AgentCapability, ProjectLocation, ThreadStatus } from "@/shared/contracts";
import type { OscNotification } from "@/shared/osc";
import {
  batchWslCommandsAsync,
  createKnownSessionRef,
  createRecursiveDirWatcher,
  detectAgentInstall,
  type AgentAdapter,
  type TerminalStatusHint,
} from "../base";
import { buildCodexArgvFor } from "./argv";
import { codexDefaultCapabilities, codexDetectionSpec } from "./detection";
import { detectRateLimitPrompt } from "./rateLimitPrompt";
import {
  installCodexPlugin,
  isCodexPluginInstalled,
  isCodexSemverSupportedForHooks,
  isCodexVersionSupportedForHooks,
  parseCodexVersionLine,
  readBundledCodexPluginVersion,
} from "./plugin/install";
import {
  describeCodexLocation,
  isInteractiveCodexRollout,
  readCodexRolloutMetaForLocation,
  readCodexRolloutsForLocation,
  readCodexSessionIndexForLocation,
  resolveCodexSessionsWatchPath,
} from "./session";
import type { CodexRolloutMeta } from "./sessionFiles";
import { detectCodexReadyForInitialPrompt, detectCodexTerminalStatus } from "./terminal";

export { buildCodexAppServerCommand, CODEX_REMOTE_TUI_FEATURE } from "./argv";
export { deriveCodexStructuredState, parseCodexSocketMessage } from "./acp";
export {
  detectCodexReadyForInitialPrompt,
  detectCodexTerminalStatus,
  detectCodexUpdatePrompt,
} from "./terminal";

const CODEX_PLUGIN_VERSION = readBundledCodexPluginVersion();
const CODEX_MIN_PROTOCOL_VERSION = 1;
const CODEX_MIN_HOOKS_VERSION_LABEL = "0.122.0";

if (CODEX_PLUGIN_VERSION === "0.0.0") {
  // Module-load fallback: plugin.json wasn't resolvable. L1 hooks will be
  // disabled for this session; the coordinator treats `0.0.0` as a retry
  // sentinel so the next app launch installs fresh once the manifest is in
  // place (dev: src/supervisor/agents/codex/plugin/; packaged: resources/
  // agent-plugins/codex/ — staged by scripts/prepare-agent-plugins.mjs).
  console.warn(
    "[codex] plugin manifest not found at module load — CLI hooks disabled for this session. " +
      "If you just added the plugin files, restart the app to enable hooks.",
  );
}

function codexOscEventText(notification: OscNotification): string {
  const parts: string[] = [notification.title, notification.body];
  const p = notification.payload;
  if (p && typeof p === "object") {
    parts.push(JSON.stringify(p));
    for (const key of ["event", "type", "kind", "name", "notification", "id"] as const) {
      const v = p[key];
      if (typeof v === "string") {
        parts.push(v);
      }
    }
  }
  return parts
    .filter((s) => s.length > 0)
    .join("\n")
    .toLowerCase();
}

function codexOscHint(notification: OscNotification): TerminalStatusHint | null {
  const t = codexOscEventText(notification);
  if (
    t.includes("approval") ||
    t.includes("permission-requested") ||
    t.includes("permission_requested") ||
    t.includes("needs_approval") ||
    // Plan-mode prompt: Codex pauses after presenting a plan until the user
    // approves / edits / rejects. Emits OSC 9 with body "Plan mode prompt: …".
    t.includes("plan mode prompt")
  ) {
    return { status: "needs_approval", attention: "needs_approval", corroborated: true };
  }
  // Codex 0.122+ uses notify (OSC 9 / 777 / 99) per Growl/notify semantics:
  // the terminal emits a notification whenever a turn ends (and then includes
  // the assistant's response text as the body). So any OSC notification that
  // doesn't match an approval / prompt keyword corresponds to "turn complete"
  // → idle.
  //
  // We still keep the explicit keyword match above so an approval-style notify
  // wins, even if it happens to also carry response text.
  if (t.length > 0) {
    return { status: "idle", attention: "none", corroborated: true };
  }
  return null;
}

/** Ignore uncorroborated TUI `idle` while ACP says we're still working. */
function shouldIgnoreCodexWeakTerminalIdle(input: {
  hint: TerminalStatusHint;
  status: ThreadStatus;
  hasStructuredSession: boolean;
}): boolean {
  return (
    input.hasStructuredSession &&
    input.status === "working" &&
    input.hint.status === "idle" &&
    !input.hint.corroborated
  );
}

export function createCodexAdapter(): AgentAdapter {
  let capabilities: AgentCapability = codexDefaultCapabilities;
  let preSpawnRolloutIds = new Set<string>();

  return {
    kind: "codex",
    label: "Codex",
    get capabilities() {
      return capabilities;
    },
    spawnEnv: { wsl: { BROWSER: "/bin/true" } },
    pluginId: "lightcode-status@codex",
    pluginVersion: CODEX_PLUGIN_VERSION,
    minProtocolVersion: CODEX_MIN_PROTOCOL_VERSION,
    async isPluginSupported(ctx) {
      if (ctx.envKind === "wsl" && ctx.wslDistro) {
        const [nodeOk, verOut] = await batchWslCommandsAsync(ctx.wslDistro, [
          "command -v node",
          "codex --version",
        ]);
        if (!nodeOk?.ok) {
          console.warn(
            `[codex] WSL hook plugin unsupported in distro ${ctx.wslDistro}: ` +
              "Node.js is not available in the login-shell PATH",
          );
          return false;
        }
        const versionLine =
          verOut?.stdout
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
        const v = parseCodexVersionLine(versionLine);
        if (!isCodexSemverSupportedForHooks(v)) {
          console.warn(
            `[codex] WSL hook plugin unsupported in distro ${ctx.wslDistro}: ` +
              `need codex-cli >= ${CODEX_MIN_HOOKS_VERSION_LABEL}, got ${
                versionLine || "(unparseable `codex --version` output)"
              }`,
          );
          return false;
        }
        return true;
      }
      return isCodexVersionSupportedForHooks();
    },
    isPluginInstalled(ctx) {
      return isCodexPluginInstalled(ctx);
    },
    async installPlugin(ctx) {
      const result = installCodexPlugin(ctx);
      if (!result.ok) return result;
      return { ok: true, version: result.version };
    },
    async pluginLaunchExtras() {
      return { args: ["--enable", "codex_hooks"] };
    },
    handleOscNotification: codexOscHint,
    oscHintsDeferToHookPlugin: true,
    detectTerminalStatus: detectCodexTerminalStatus,
    detectTerminalStatusOnHookPluginPtyData: true,
    shouldIgnoreTerminalStatusHint: shouldIgnoreCodexWeakTerminalIdle,
    workingSilenceTimeoutMs: null,
    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, codexDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },
    buildLaunchArgv(location: ProjectLocation, config, prompt, sessionRef, launchOptions) {
      const sessions = readCodexSessionIndexForLocation(location);
      const rollouts = readCodexRolloutsForLocation(location);
      preSpawnRolloutIds = new Set(rollouts.map((rollout) => rollout.id));
      console.log(
        "[codex] pre-spawn session snapshot (%s): sessionIndex=%d latestIndex=%s interactiveRollouts=%d",
        describeCodexLocation(location),
        sessions.length,
        sessions.at(-1)?.id ?? "(none)",
        rollouts.length,
      );
      return buildCodexArgvFor(config, prompt, sessionRef, launchOptions);
    },
    buildResumeArgv(_location, config, prompt, sessionRef, launchOptions) {
      return buildCodexArgvFor(config, prompt, sessionRef, launchOptions);
    },
    createInitialSessionRef() {
      return undefined;
    },
    shouldDeferPromptToTerminal(config) {
      return config.mode === "plan";
    },
    buildTerminalPreInputs(config) {
      if (config.mode === "plan") {
        return [["/plan", "@wait:160", "\r"]];
      }
      return undefined;
    },
    buildDirectInput(prompt) {
      return [prompt, "@wait:160", "\r"];
    },
    isReadyForInitialPrompt(text) {
      return detectCodexReadyForInitialPrompt(text);
    },
    detectAutoResponse(text) {
      if (detectRateLimitPrompt(text)) return "2";
      return null;
    },
    initialSessionRefDiscoveryDelayMs: 1000,
    watchSessionRef(location, onChanged) {
      const watchPath = resolveCodexSessionsWatchPath(location);
      if (!watchPath) return undefined;
      return createRecursiveDirWatcher(
        watchPath,
        onChanged,
        `codex:${describeCodexLocation(location)}`,
      );
    },
    async discoverSessionRef(location) {
      try {
        const sessions = readCodexSessionIndexForLocation(location);
        const rollouts = readCodexRolloutsForLocation(location);
        const newRollouts = rollouts
          .filter((rollout) => !preSpawnRolloutIds.has(rollout.id))
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        let next: CodexRolloutMeta | undefined;
        for (const candidate of newRollouts) {
          const meta = readCodexRolloutMetaForLocation(location, candidate);
          if (meta && isInteractiveCodexRollout(meta, location)) {
            next = meta;
            break;
          }
        }
        console.log(
          "[codex] discoverSessionRef (%s): sessionIndex=%d interactiveRollouts=%d preSpawnRollouts=%d newRollouts=%d latestIndex=%s candidate=%s originator=%s source=%s",
          describeCodexLocation(location),
          sessions.length,
          rollouts.length,
          preSpawnRolloutIds.size,
          newRollouts.length,
          sessions.at(-1)?.id ?? "(none)",
          next?.id ?? "(none)",
          next?.originator ?? "(none)",
          next?.source ?? "(none)",
        );
        if (!next) {
          return undefined;
        }
        console.log("[codex] discovered interactive session id from rollout file: %s", next.id);
        return createKnownSessionRef(next.id);
      } catch (error) {
        console.log(
          "[codex] discoverSessionRef failed (%s): %s",
          describeCodexLocation(location),
          error instanceof Error ? error.message : String(error),
        );
        return undefined;
      }
    },
    defaultOneShotModel: "gpt-5.4-mini",
    buildOneShotCommand(model, effort) {
      const args = ["exec", "-m", model];
      if (effort) {
        args.push("-c", `model_reasoning_effort="${effort}"`);
      }
      args.push("-");
      return { command: "codex", args };
    },
    buildContextExtractionCommand(_sessionRef, _location, _model) {
      return undefined;
    },
  };
}
