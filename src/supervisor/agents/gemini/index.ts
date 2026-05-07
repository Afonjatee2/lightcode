import type { AgentCapability, PromptSegment } from "@/shared/contracts";
import { EXTRACTION_PROMPT } from "@/supervisor/contextExtractor";
import { createAcpStructuredSession } from "../acp";
import {
  buildAgentCommand,
  createKnownSessionRef,
  createRecursiveDirWatcher,
  detectAgentInstall,
  type AgentAdapter,
  type CreateStructuredSessionInput,
  type TerminalStatusHint,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { resolveInstallNodePath, warnIfPluginManifestMissing } from "../plugin/installerBase";
import { buildGeminiArgs } from "./argv";
import { defaultGeminiCapabilities, geminiDetectionSpec } from "./detection";
import {
  getGeminiPluginPaths,
  installGeminiPlugin,
  isGeminiPluginInstalled,
  readBundledGeminiPluginVersion,
} from "./plugin/install";
import {
  detectGeminiInvalidSessionRef,
  queryLatestSessionId,
  resolveGeminiWatchPath,
} from "./session";
import { detectGeminiTerminalStatus } from "./terminal";

export { detectGeminiInvalidSessionRef } from "./session";

const GEMINI_PLUGIN_VERSION = readBundledGeminiPluginVersion();

warnIfPluginManifestMissing("gemini", GEMINI_PLUGIN_VERSION);

function geminiHookActiveTerminalFallback(hint: TerminalStatusHint): boolean {
  return hint.status === "needs_reply" || hint.status === "needs_approval";
}

export function createGeminiAdapter(): AgentAdapter {
  /** Latest session ID seen before the TUI spawned — used to detect the new one. */
  let preSpawnLatestId: string | undefined;
  let capabilities: AgentCapability = defaultGeminiCapabilities;

  return {
    kind: "gemini",
    label: "Gemini",
    get capabilities() {
      return capabilities;
    },
    // GEMINI_CLI_TRUST_WORKSPACE=true bypasses Gemini's folder-trust check.
    // Without it, the AgentRegistry emits "Skipping project agents due to
    // untrusted folder..." onto stdout, which can collide with JSON-RPC
    // frames in --acp mode and break the ACP stream parser.
    spawnEnv: {
      native: { GEMINI_CLI_TRUST_WORKSPACE: "true" },
      wsl: { BROWSER: "/bin/true", GEMINI_CLI_TRUST_WORKSPACE: "true" },
    },
    pluginId: "lightcode-status@gemini",
    pluginVersion: GEMINI_PLUGIN_VERSION,
    minProtocolVersion: 1,

    async isPluginSupported(ctx) {
      // Native: forward.mjs runs under Electron-as-Node via a wrapper.
      // WSL: hooks always supported; the runtime resolver probes the distro
      // for an existing node and falls back to installing the pinned LTS if
      // none is available. The actual install happens in `installPlugin`.
      void ctx;
      return true;
    },
    async isPluginInstalled(ctx) {
      return isGeminiPluginInstalled(ctx);
    },
    async installPlugin(ctx) {
      const node = await resolveInstallNodePath(ctx);
      if (!node.ok) return node;
      const result = installGeminiPlugin(ctx, { resolvedNodePath: node.nodePath });
      if (!result.ok) return result;
      return { ok: true, version: result.version };
    },
    async pluginLaunchExtras(ctx) {
      const paths = getGeminiPluginPaths(ctx);
      return { env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: paths.settingsPath } };
    },

    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, geminiDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },

    buildLaunchArgv(location, config, prompt) {
      // Snapshot the latest session ID before TUI spawn so we can detect the new one
      void queryLatestSessionId(location).then((id) => {
        preSpawnLatestId = id;
      });
      const args = buildGeminiArgs(config, prompt);
      return { binary: "gemini", args };
    },

    buildResumeArgv(_location, config, prompt, sessionRef) {
      const args = buildGeminiArgs(config, prompt, sessionRef.providerSessionId);
      return { binary: "gemini", args };
    },

    async createStructuredSession(input: CreateStructuredSessionInput) {
      const command = buildAgentCommand(
        input.projectLocation,
        "gemini",
        ["--acp"],
        resolveAgentBinaryPath(input.projectLocation, "gemini"),
        { GEMINI_CLI_TRUST_WORKSPACE: "true" },
      );
      return createAcpStructuredSession(command, input);
    },

    createInitialSessionRef() {
      return undefined;
    },

    buildDirectInput(prompt) {
      // Gemini's TUI treats bulk writes as pastes. Newlines in pasted text
      // become input newlines instead of submit. Use empty spacer chunks to
      // add ~50ms delay between the text and the Enter key so the TUI
      // processes them as separate events (type → submit).
      return [prompt, "@wait:40", "\r"];
    },

    formatPromptSegments(segments: PromptSegment[]) {
      // Gemini CLI's @ handler doesn't expand ~ — always use full absolute paths.
      const attachments = segments.filter((s) => s.kind === "attachment");
      const rest = segments.filter((s) => s.kind !== "attachment");
      const attachmentLines = attachments.map((s) => `@${s.path}`).join(" ");
      const restStr = rest.map((s) => (s.kind === "file" ? `@${s.path}` : s.content)).join("");
      return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
    },
    detectTerminalStatus: detectGeminiTerminalStatus,
    shouldApplyTerminalStatusWhileHookActive: geminiHookActiveTerminalFallback,
    detectInvalidSessionRef: detectGeminiInvalidSessionRef,

    defaultOneShotModel: "gemini-2.5-flash",

    async discoverSessionRef(location) {
      try {
        const latestId = await queryLatestSessionId(location);
        if (!latestId || latestId === preSpawnLatestId) return undefined;
        return createKnownSessionRef(latestId);
      } catch {
        return undefined;
      }
    },
    watchSessionRef(location, onChanged) {
      const watchPath = resolveGeminiWatchPath(location);
      if (!watchPath) return undefined;
      return createRecursiveDirWatcher(watchPath, onChanged, `gemini:${location.kind}`);
    },

    buildOneShotCommand(model, _effort, prompt) {
      if (!prompt) return undefined;
      return { command: "gemini", args: ["-p", prompt, "--model", model], stdin: "" };
    },
    buildContextExtractionCommand(sessionRef, _location, model) {
      return {
        command: "gemini",
        args: [
          "-p",
          EXTRACTION_PROMPT,
          "--resume",
          sessionRef.providerSessionId,
          "--model",
          model ?? "gemini-2.5-flash",
        ],
        stdin: "",
      };
    },
  };
}
