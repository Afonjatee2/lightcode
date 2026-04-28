import { randomUUID } from "node:crypto";

import type { PromptSegment } from "@/shared/contracts";
import type { OscNotification, OscTitle } from "@/shared/osc";
import {
  createKnownSessionRef,
  detectAgentInstall,
  shortenHomePath,
  type AgentAdapter,
  type TerminalStatusHint,
} from "../base";
import { buildClaudeArgs } from "./argv";
import { claudeCapabilities, claudeDetectionSpec } from "./detection";
import { resolveInstallNodePath, warnIfPluginManifestMissing } from "../plugin/installerBase";
import {
  getClaudePluginPaths,
  installClaudePlugin,
  isClaudePluginInstalled,
  readBundledClaudePluginVersion,
} from "./plugin/install";

// Semver comes only from plugin/plugin.json (forward.mjs reads that file too).
// Bump `MIN_PROTOCOL_VERSION` in src/shared/contracts/agentEvent.ts when the
// envelope shape changes.
const CLAUDE_PLUGIN_VERSION = readBundledClaudePluginVersion();

warnIfPluginManifestMissing("claude", CLAUDE_PLUGIN_VERSION);

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

// With `preferredNotifChannel: "iterm2"` (set by the staged settings.json,
// plugin/install.ts), Claude Code emits the iTerm2 **OSC 9;4 progress
// sub-protocol** instead of plain-text OSC 9 notifications. Body shape is
// `4;<state>[;<percent>]` where state is:
//   0 = remove progress  → idle (turn complete)
//   1 = set progress %   → working (determinate)
//   2 = error            → (ignore — no clean mapping)
//   3 = indeterminate    → working (Claude uses this during a turn)
//   4 = paused           → (ignore — Claude doesn't emit it in practice)
// Observed real-world bodies: "4;0;", "4;0;0", "4;3;0".
const CLAUDE_PROGRESS_RE = /^4;(\d+)/;

function claudeOscHint(notification: OscNotification): TerminalStatusHint | null {
  if (notification.code !== 9) return null;
  const match = CLAUDE_PROGRESS_RE.exec(notification.body);
  if (!match) return null;
  const state = Number(match[1]);
  if (state === 0) return { status: "idle", attention: "none", corroborated: true };
  if (state === 1 || state === 3) {
    return { status: "working", attention: "working", corroborated: true };
  }
  return null;
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
    minProtocolVersion: 1,
    async isPluginSupported(ctx) {
      // Native: forward.mjs runs under Electron-as-Node via a generated
      // wrapper script — always supported.
      // WSL: hooks always supported; the runtime resolver probes the distro
      // for an existing node and falls back to installing the pinned LTS if
      // none is available. The actual install happens in `installPlugin`.
      void ctx;
      return true;
    },
    async isPluginInstalled(ctx) {
      return isClaudePluginInstalled(ctx);
    },
    async installPlugin(ctx) {
      const node = await resolveInstallNodePath(ctx);
      if (!node.ok) return node;
      const result = installClaudePlugin(ctx, { resolvedNodePath: node.nodePath });
      if (!result.ok) return result;
      return { ok: true, version: result.version };
    },
    async pluginLaunchExtras(ctx) {
      const paths = getClaudePluginPaths(ctx);
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
    handleOscNotification: claudeOscHint,
    handleOscTitle: claudeOscTitleHint,
    oscHintsDeferToHookPlugin: true,
    workingSilenceTimeoutMs: null,
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
