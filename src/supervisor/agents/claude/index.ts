import { randomUUID } from "node:crypto";

import type { PromptSegment } from "@/shared/contracts";
import type { OscTitle } from "@/shared/osc";
import {
  applyTerminalHintToConfig,
  batchWslCommandsAsync,
  createKnownSessionRef,
  detectAgentInstall,
  shortenHomePath,
  type AgentAdapter,
  type TerminalStatusHint,
} from "../base";
import { buildClaudeArgs } from "./argv";
import { claudeCapabilities, claudeDetectionSpec } from "./detection";
import { detectClaudeTerminalStatus } from "./terminal";
import {
  getClaudePluginPaths,
  installClaudePlugin,
  isClaudePluginInstalled,
  readBundledClaudePluginVersion,
} from "./plugin/install";

export { detectClaudeTerminalStatus, detectClaudeModelEffort } from "./terminal";

// Semver comes only from plugin/plugin.json (forward.mjs reads that file too).
// Bump `MIN_PROTOCOL_VERSION` in src/shared/contracts/agentEvent.ts when the
// envelope shape changes.
const CLAUDE_PLUGIN_VERSION = readBundledClaudePluginVersion();
const CLAUDE_MIN_PROTOCOL_VERSION = 1;

if (CLAUDE_PLUGIN_VERSION === "0.0.0") {
  console.warn(
    "[claude] plugin manifest not found at module load — CLI hooks disabled for this session. " +
      "If you just added the plugin files, restart the app to enable hooks.",
  );
}

// Claude Code animates its working-state spinner in the terminal title via
// OSC 0/2 with a leading braille glyph (U+2800–U+28FF). Real sessions observed
// the 2-frame animation `⠂` / `⠐` prefixed onto the thread title. Matching
// only at the start of the title avoids misfiring on braille glyphs that
// happen to appear inside the user-visible task name.
const BRAILLE_PREFIX_RE = /^[⠀-⣿]/;

function claudeOscTitleHint(title: OscTitle): TerminalStatusHint | null {
  if (!BRAILLE_PREFIX_RE.test(title.text)) return null;
  return { status: "working", attention: "working", corroborated: true };
}

export function createClaudeAdapter(): AgentAdapter {
  return {
    kind: "claude",
    label: "Claude Code",
    capabilities: claudeCapabilities,
    // WSL OAuth flows try to open a browser; no-op it so the PTY doesn't hang.
    spawnEnv: { wsl: { BROWSER: "/bin/true" } },
    detectInstall(ctx) {
      return detectAgentInstall(ctx, claudeDetectionSpec);
    },
    // ── CLI hook plugin support ──────────────────────────────────────────
    pluginId: "lightcode-status@claude",
    pluginVersion: CLAUDE_PLUGIN_VERSION,
    minProtocolVersion: CLAUDE_MIN_PROTOCOL_VERSION,
    async isPluginSupported(ctx) {
      // The forwarder runs `node`, so we need a Node runtime to be available.
      // For native Windows/macOS/Linux Claude this is implicit (the supervisor
      // itself ships with Node). For WSL we have to actually probe the distro
      // — common, but not guaranteed.
      if (ctx.envKind !== "wsl" || !ctx.wslDistro) return true;
      const [result] = await batchWslCommandsAsync(ctx.wslDistro, ["command -v node"]);
      return Boolean(result?.ok && result.stdout.trim().length > 0);
    },
    async isPluginInstalled(ctx) {
      return isClaudePluginInstalled(ctx, ctx.baseDir);
    },
    async installPlugin(ctx) {
      const result = installClaudePlugin(ctx, ctx.baseDir);
      if (!result.ok) return result;
      return { ok: true, version: result.version };
    },
    async pluginLaunchExtras(ctx) {
      const paths = getClaudePluginPaths(ctx, ctx.baseDir);
      return { args: ["--settings", paths.settingsPath] };
    },
    buildLaunchArgv(_location, config, prompt, _sessionRef, _launchOptions) {
      const assignedId = randomUUID();
      const args = buildClaudeArgs(config, prompt, undefined, assignedId);
      return {
        binary: "claude",
        args,
        sessionRef: createKnownSessionRef(assignedId),
      };
    },
    buildResumeArgv(_location, config, prompt, sessionRef, _launchOptions) {
      const args = buildClaudeArgs(config, prompt, sessionRef.providerSessionId);
      return { binary: "claude", args };
    },
    createInitialSessionRef() {
      return undefined;
    },
    buildDirectInput(prompt, segments) {
      const attachmentCount = segments?.filter((s) => s.kind === "attachment").length ?? 0;
      const wait = attachmentCount > 0 ? 800 + (attachmentCount - 1) * 150 : 60;
      return [prompt, `@wait:${wait}`, "\r"];
    },
    formatPromptSegments(segments: PromptSegment[]) {
      // Claude CLI natively handles @path for files and images — pass as @path inline.
      // Attachments are appended so the text prompt leads (better for title generation).
      // Shorten absolute home-dir paths to ~/... for a cleaner prompt line.
      const attachments = segments.filter((s) => s.kind === "attachment");
      const rest = segments.filter((s) => s.kind !== "attachment");
      const attachmentLines = attachments.map((s) => `@${shortenHomePath(s.path)}`).join(" ");
      const restStr = rest.map((s) => (s.kind === "file" ? `@${s.path}` : s.content)).join("");
      return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
    },
    detectTerminalStatus: detectClaudeTerminalStatus,
    handleOscTitle: claudeOscTitleHint,
    oscHintsDeferToHookPlugin: true,
    workingSilenceTimeoutMs: null,
    syncConfigFromTerminalState: applyTerminalHintToConfig,
    defaultOneShotModel: "haiku",
    buildOneShotCommand(model, effort) {
      const args = ["-p", "--model", model];
      if (effort) {
        args.push("--effort", effort);
      }
      return { command: "claude", args };
    },
    buildContextExtractionCommand(sessionRef, _location, model) {
      const args = ["-p", "--resume", sessionRef.providerSessionId, "--model", model ?? "haiku"];
      return { command: "claude", args };
    },
  };
}
