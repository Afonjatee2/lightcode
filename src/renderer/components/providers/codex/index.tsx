export * from "./CodexStatusIcon";

import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { CodexStatusIcon } from "./CodexStatusIcon";
import { fullAccessToggle, planWorkToggle } from "../composerControlBuilders";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConfigNormalizer,
  registerConflictResolverDefaults,
  registerGuiSlashCommands,
  registerProviderIcon,
  registerProviderLabel,
  registerTitleGenDefaults,
} from "../ProviderIcon";

registerProviderIcon("codex", CodexStatusIcon);
registerProviderLabel("codex", "Codex");
registerCommitGenDefaults("codex", {
  label: "Codex",
  hint: "GPT-5.4 Mini xhigh",
  model: "gpt-5.4-mini",
  effort: "xhigh",
});
registerTitleGenDefaults("codex", {
  label: "Codex",
  hint: "GPT-5.4 Mini medium",
  model: "gpt-5.4-mini",
  effort: "medium",
});
registerConflictResolverDefaults("codex", {
  label: "Codex",
  hint: "GPT-5.5 high",
  model: "gpt-5.5",
  effort: "high",
});

registerConfigNormalizer("codex", ({ config, presentationMode }) => {
  // Plan mode is wired only through ACP; the terminal CLI ignores it.
  if (presentationMode === "terminal" && config.mode === "plan") {
    return { mode: "agent" };
  }
  return {};
});

registerGuiSlashCommands("codex", {
  buildCommands: ({ hasEffort, supportsFast }) => [
    { id: "model", label: "model - Open the model picker", description: "Open the model picker" },
    {
      id: "plan",
      label: "plan - Switch this chat to plan mode",
      description: "Switch this chat to plan mode",
    },
    {
      id: "agent",
      label: "agent - Switch this chat to agent mode",
      description: "Switch this chat to agent mode",
    },
    {
      id: "goal",
      label: "goal - Set or view an experimental goal",
      description: "Set or view an experimental goal",
    },
    ...(hasEffort
      ? [
          {
            id: "effort",
            label: "effort - Open the effort picker",
            description: "Open the effort picker",
          },
        ]
      : []),
    ...(supportsFast
      ? [{ id: "fast", label: "fast - Toggle Fast mode", description: "Toggle Fast mode" }]
      : []),
  ],
  resolveLocalAction: (typed) => {
    const normalized = typed.trim().toLowerCase();
    if (normalized === "/model") return { kind: "open-control", target: "model" };
    if (normalized === "/effort") return { kind: "open-control", target: "effort" };
    if (normalized === "/fast") return { kind: "toggle-fast" };
    if (normalized === "/plan") return { kind: "set-mode", mode: "plan" };
    if (normalized === "/agent") return { kind: "set-mode", mode: "agent" };
    return null;
  },
});

const CODEX_PERMISSION_PRESETS = [
  {
    id: "default-permissions",
    label: "Default permissions",
    hint: "Use config",
    approvalPolicies: [],
    sandboxModes: [],
  },
  {
    id: "auto-review",
    label: "Auto-review",
    hint: "Review failures",
    approvalPolicies: ["on-failure"],
    sandboxModes: ["workspace-write"],
  },
  {
    id: "full-access",
    label: "Full access",
    hint: "No prompts",
    approvalPolicies: ["never"],
    sandboxModes: ["danger-full-access"],
  },
] as const;

type CodexPermissionPreset = (typeof CODEX_PERMISSION_PRESETS)[number];

function resolveCodexPermissionPreset(
  preset: CodexPermissionPreset,
  approvalIds: Set<string>,
  sandboxIds: Set<string>,
): { approvalPolicy: string; sandboxMode: string } | undefined {
  if (preset.approvalPolicies.length === 0 && preset.sandboxModes.length === 0) {
    return { approvalPolicy: "", sandboxMode: "" };
  }

  const approvalPolicy = preset.approvalPolicies.find((id) => approvalIds.has(id));
  const sandboxMode = preset.sandboxModes.find((id) => sandboxIds.has(id));
  return approvalPolicy && sandboxMode ? { approvalPolicy, sandboxMode } : undefined;
}

function isCodexPermissionPresetSelected(
  preset: CodexPermissionPreset & { approvalPolicy: string; sandboxMode: string },
  config: { approvalPolicy?: string | undefined; sandboxMode?: string | undefined },
): boolean {
  if (!preset.approvalPolicy && !preset.sandboxMode) {
    return !config.approvalPolicy && !config.sandboxMode;
  }
  return (
    preset.approvalPolicy === config.approvalPolicy && preset.sandboxMode === config.sandboxMode
  );
}

registerComposerControls("codex", {
  // ACP exposes plan mode and the coupled approval/sandbox preset selector.
  gui: ({ capabilities, config, isDisabled, onConfigChange }) => {
    const isPlanMode = (config.mode ?? "agent") !== "agent";
    const controls: ComposerControl[] = [
      planWorkToggle({
        isPlanMode,
        isDisabled,
        onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
      }),
    ];

    const approvalIds = new Set(capabilities.approvalPolicies.map((policy) => policy.id));
    const sandboxIds = new Set(capabilities.sandboxModes.map((mode) => mode.id));
    const permissionPresets = CODEX_PERMISSION_PRESETS.flatMap((preset) => {
      const resolved = resolveCodexPermissionPreset(preset, approvalIds, sandboxIds);
      return resolved ? [{ ...preset, ...resolved }] : [];
    });
    if (permissionPresets.length > 0) {
      const currentPermissionPreset =
        permissionPresets.find((preset) => isCodexPermissionPresetSelected(preset, config)) ??
        permissionPresets[0]!;
      controls.push({
        iconKind: "permission",
        options: permissionPresets.map((preset) => ({
          id: preset.id,
          label: preset.label,
          hint: preset.hint,
        })),
        hideLabelOnWrap: true,
        value: currentPermissionPreset.id,
        isDisabled,
        onChange: (value) => {
          const preset = permissionPresets.find((option) => option.id === value);
          if (!preset) return;
          onConfigChange({
            approvalPolicy: preset.approvalPolicy,
            sandboxMode: preset.sandboxMode,
          });
        },
      });
    }
    return controls;
  },
  // Terminal CLI ignores `mode: "plan"` and exposes a single Full Access
  // toggle instead of the paired approval/sandbox selector.
  terminal: ({ capabilities, config, isDisabled, onConfigChange }) => {
    const hasPermissions =
      capabilities.approvalPolicies.length > 0 || capabilities.sandboxModes.length > 0;
    if (!hasPermissions) return [];
    const isFullAccess =
      config.approvalPolicy === "never" && config.sandboxMode === "danger-full-access";
    return [
      fullAccessToggle({
        isFullAccess,
        isDisabled,
        onChange: (selected) => {
          if (selected) {
            onConfigChange({ approvalPolicy: "never", sandboxMode: "danger-full-access" });
          } else {
            onConfigChange({ approvalPolicy: "", sandboxMode: "" });
          }
        },
      }),
    ];
  },
});
