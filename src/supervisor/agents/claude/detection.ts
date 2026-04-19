import type { AgentCapability } from "@/shared/contracts";
import { cliSubcommandAuthProbe, type DetectionSpec } from "../base";

export const claudeCapabilities: AgentCapability = {
  models: [
    { id: "claude-opus-4-6[1m]", label: "Opus 1M" },
    { id: "sonnet", label: "Sonnet" },
    { id: "haiku", label: "Haiku" },
  ],
  efforts: ["low", "medium", "high", "xHigh", "max"],
  defaultEffort: "high",
  modelEfforts: {
    haiku: [],
    sonnet: ["low", "medium", "high"],
  },
  modes: ["agent", "plan"],
  approvalPolicies: [
    { id: "default", label: "Default" },

    { id: "acceptEdits", label: "Accept Edits" },
    { id: "dontAsk", label: "Don't Ask" },
    { id: "bypassPermissions", label: "Bypass Permissions" },
  ],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  bypassApprovalPolicy: "bypassPermissions",
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
};
