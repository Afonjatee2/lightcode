import type { AgentCapability, ProjectLocation } from "@/shared/contracts";
import {
  createKnownSessionRef,
  createRecursiveDirWatcher,
  detectAgentInstall,
  type AgentAdapter,
} from "../base";
import { buildCodexArgvFor } from "./argv";
import { codexDefaultCapabilities, codexDetectionSpec } from "./detection";
import { detectRateLimitPrompt } from "./rateLimitPrompt";
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
    detectTerminalStatus(text) {
      return detectCodexTerminalStatus(text);
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
      // Codex doesn't support --resume in exec mode; rely on scrollback fallback
      return undefined;
    },
  };
}
