import type { AgentCapability } from "@/shared/contracts";
import { cliSubcommandAuthProbe, type DetectionSpec } from "../base";
import { probeClaudeCapabilities } from "./probe";

/** Default `--permission-mode` when `ThreadConfig.approvalPolicy` is omitted. */
export const CLAUDE_DEFAULT_APPROVAL_POLICY = "auto" as const;

export const claudeCapabilities: AgentCapability = {
  models: [
    { id: "claude-opus-4-7[1m]", label: "Opus 4.7" },
    { id: "claude-opus-4-6[1m]", label: "Opus 4.6" },
    { id: "sonnet", label: "Sonnet" },
    { id: "haiku", label: "Haiku" },
  ],
  efforts: ["low", "medium", "high", "xHigh", "max"],
  defaultEffort: "high",
  modelEfforts: {
    "claude-opus-4-6[1m]": ["low", "medium", "high", "max"],
    haiku: [],
    sonnet: ["low", "medium", "high"],
  },
  modes: ["agent", "plan"],
  approvalPolicies: [
    { id: "default", label: "Default" },
    { id: "auto", label: "Auto mode" },
    { id: "acceptEdits", label: "Accept Edits" },
    { id: "dontAsk", label: "Don't Ask" },
    { id: "bypassPermissions", label: "Bypass Permissions" },
  ],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  bypassApprovalPolicy: CLAUDE_DEFAULT_APPROVAL_POLICY,
  settingDefs: [
    {
      key: "usePowershellTool",
      type: "toggle" as const,
      env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" },
      label: "Use PowerShell tool",
      description: "Use PowerShell as the shell tool instead of Bash.",
      default: process.platform === "win32",
      platforms: ["win32"],
    },
    {
      key: "noFlicker",
      type: "toggle" as const,
      env: { CLAUDE_CODE_NO_FLICKER: "1" },
      label: "No flicker mode",
      description: "Reduces terminal flicker in the Claude Code TUI.",
      default: true,
    },
    {
      key: "scrollSpeed",
      type: "select" as const,
      envVar: "CLAUDE_CODE_SCROLL_SPEED",
      label: "TUI scroll speed",
      description: "Scroll speed inside the no-flicker TUI.",
      default: "5",
      options: Array.from({ length: 10 }, (_, i) => ({
        id: String(i + 1),
        label: `${i + 1}x`,
      })),
    },
  ],
};

export const claudeDetectionSpec: DetectionSpec = {
  kind: "claude",
  label: "Claude Code",
  binary: "claude",
  capabilities: claudeCapabilities,
  authProbes: [cliSubcommandAuthProbe(["auth", "status"])],
  capabilitiesProbe: (ctx) => probeClaudeCapabilities(ctx),
};
