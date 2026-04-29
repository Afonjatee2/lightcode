import type { AgentCapability } from "@/shared/contracts";
import { EXTRACTION_PROMPT } from "@/supervisor/contextExtractor";
import {
  createKnownSessionRef,
  detectAgentInstall,
  type AgentAdapter,
  type TerminalStatusHint,
} from "../base";
import { warnIfPluginManifestMissing } from "../plugin/installerBase";
import { buildOpenCodeArgs } from "./argv";
import { opencodeDefaultCapabilities, opencodeDetectionSpec } from "./detection";
import {
  installOpenCodePlugin,
  isOpenCodePluginInstalled,
  readBundledOpenCodePluginVersion,
  uninstallOpenCodePlugin,
} from "./plugin/install";
import { queryLatestOpenCodeSessionId } from "./session";
import { detectOpenCodeTerminalStatus, opencodeOscHint, opencodeOscTitleHint } from "./terminal";

const OPENCODE_PLUGIN_VERSION = readBundledOpenCodePluginVersion();

// Default model for one-shot calls (commit / title gen, context extraction).
// `big-pickle` is OpenCode's free always-on house model — every other model
// in `opencode models` requires the user to have configured a paid provider,
// so it's the only safe out-of-the-box default. Renderer keeps its own
// constant; the two bundles can't share runtime symbols.
const OPENCODE_DEFAULT_ONE_SHOT_MODEL = "opencode/big-pickle";

warnIfPluginManifestMissing(
  "opencode",
  OPENCODE_PLUGIN_VERSION,
  "Expected at src/supervisor/agents/opencode/plugin/ (dev) or " +
    "resources/agent-plugins/opencode/ (packaged, staged by scripts/prepare-agent-plugins.mjs).",
);

// Only allow text-derived `needs_approval` signals through while L1 is active —
// those can race ahead of the `permission.asked` hook on slow ingress paths and
// the cost of a duplicate transition is zero.
function opencodeHookActiveTerminalFallback(hint: TerminalStatusHint): boolean {
  return hint.status === "needs_approval";
}

export function createOpenCodeAdapter(): AgentAdapter {
  let preSpawnLatestId: string | undefined;
  let capabilities: AgentCapability = opencodeDefaultCapabilities;

  return {
    kind: "opencode",
    label: "OpenCode",
    get capabilities() {
      return capabilities;
    },
    spawnEnv: { wsl: { BROWSER: "/bin/true" } },

    // ── CLI hook plugin support ──────────────────────────────────────────
    pluginId: "lightcode-status@opencode",
    pluginVersion: OPENCODE_PLUGIN_VERSION,
    minProtocolVersion: 1,
    async isPluginSupported(ctx) {
      // OpenCode auto-loads any `.mjs` file in its plugins dir on every
      // launch (per https://opencode.ai/docs/plugins). No version gate, no
      // platform restriction.
      void ctx;
      return true;
    },
    async isPluginInstalled(ctx) {
      return isOpenCodePluginInstalled(ctx);
    },
    async installPlugin(ctx) {
      // No node resolution needed — OpenCode runs the plugin under its own
      // runtime. Missing-distro WSL contexts are caught downstream by
      // `resolveOpenCodeWslPluginsDir → undefined`.
      return installOpenCodePlugin(ctx);
    },
    async uninstallPlugin(ctx) {
      uninstallOpenCodePlugin(ctx);
    },
    async pluginLaunchExtras() {
      // Plugin is auto-loaded from the plugins/ directory; no CLI flag or
      // env override is needed. LIGHTCODE_HOOK_URL et al are injected by the
      // cli-hook coordinator regardless of what we return.
      return {};
    },

    // ── Detection ────────────────────────────────────────────────────────
    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, opencodeDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },

    // ── Launch / resume ──────────────────────────────────────────────────
    buildLaunchArgv(location, config, prompt) {
      void queryLatestOpenCodeSessionId(location).then((id) => {
        preSpawnLatestId = id;
      });
      return { binary: "opencode", args: buildOpenCodeArgs(config, prompt) };
    },
    buildResumeArgv(_location, config, prompt, sessionRef) {
      return {
        binary: "opencode",
        args: buildOpenCodeArgs(config, prompt, sessionRef.providerSessionId),
      };
    },
    createInitialSessionRef() {
      return undefined;
    },

    // ── Input ────────────────────────────────────────────────────────────
    buildDirectInput(prompt) {
      // OpenCode's TUI accepts pasted prompts cleanly; a small wait before
      // Enter avoids the "paste-as-newline" trap Gemini hit and matches
      // Claude's empirically-tested 60ms.
      return [prompt, "@wait:60", "\r"];
    },

    // ── Session discovery ────────────────────────────────────────────────
    initialSessionRefDiscoveryDelayMs: 1000,
    async discoverSessionRef(location) {
      try {
        const latest = await queryLatestOpenCodeSessionId(location);
        if (!latest || latest === preSpawnLatestId) return undefined;
        return createKnownSessionRef(latest);
      } catch (error) {
        console.log(
          "[opencode] discoverSessionRef failed: %s",
          error instanceof Error ? error.message : String(error),
        );
        return undefined;
      }
    },
    // No fs watcher — OpenCode persists sessions in a SQLite DB; the
    // supervisor's polling cadence is good enough.

    // ── L2 (terminal heuristics + OSC) ───────────────────────────────────
    detectTerminalStatus: detectOpenCodeTerminalStatus,
    handleOscNotification: opencodeOscHint,
    handleOscTitle: opencodeOscTitleHint,
    oscHintsDeferToHookPlugin: true,
    shouldApplyTerminalStatusWhileHookActive: opencodeHookActiveTerminalFallback,
    workingSilenceTimeoutMs: null,

    // ── One-shot (commit / title gen) ────────────────────────────────────
    defaultOneShotModel: OPENCODE_DEFAULT_ONE_SHOT_MODEL,
    buildOneShotCommand(model, _effort, prompt) {
      if (!prompt) return undefined;
      return {
        command: "opencode",
        args: ["run", "--format", "json", "--model", model, prompt],
        stdin: "",
      };
    },
    buildContextExtractionCommand(sessionRef, _location, model) {
      return {
        command: "opencode",
        args: [
          "run",
          "--session",
          sessionRef.providerSessionId,
          "--model",
          model ?? OPENCODE_DEFAULT_ONE_SHOT_MODEL,
          EXTRACTION_PROMPT,
        ],
        stdin: "",
      };
    },
  };
}
