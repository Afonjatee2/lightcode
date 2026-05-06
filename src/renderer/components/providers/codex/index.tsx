export * from "./CodexStatusIcon";

import { ClipboardList } from "lucide-react";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { CodexStatusIcon } from "./CodexStatusIcon";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConfigNormalizer,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerTitleGenDefaults,
} from "../ProviderIcon";

registerProviderIcon("codex", CodexStatusIcon);
registerCommitGenDefaults("codex", {
  label: "Codex",
  hint: "GPT-5.5",
  model: "gpt-5.5",
  effort: "low",
});
registerTitleGenDefaults("codex", {
  label: "Codex",
  hint: "GPT-5.5",
  model: "gpt-5.5",
  effort: "low",
});
registerConflictResolverDefaults("codex", {
  label: "Codex",
  hint: "GPT-5.5",
  model: "gpt-5.5",
  effort: "",
});

registerConfigNormalizer("codex", ({ config, presentationMode }) => {
  // Plan mode is wired only through ACP; the terminal CLI ignores it.
  if (presentationMode === "terminal" && config.mode === "plan") {
    return { mode: "agent" };
  }
  return {};
});

const CODEX_PERMISSION_PRESETS = [
  {
    id: "supervised",
    label: "Supervised",
    hint: "Ask first",
    approvalPolicies: ["on-request"],
    sandboxModes: ["read-only", "workspace-write"],
  },
  {
    id: "auto-accept-edits",
    label: "Auto-accept edits",
    hint: "Edits allowed",
    approvalPolicies: ["on-failure", "on-request"],
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
  const approvalPolicy = preset.approvalPolicies.find((id) => approvalIds.has(id));
  const sandboxMode = preset.sandboxModes.find((id) => sandboxIds.has(id));
  return approvalPolicy && sandboxMode ? { approvalPolicy, sandboxMode } : undefined;
}

registerComposerControls("codex", {
  // ACP exposes plan mode and the coupled approval/sandbox preset selector.
  gui: ({ capabilities, config, isDisabled, onConfigChange }) => {
    const controls: ComposerControl[] = [
      {
        kind: "toggle",
        icon: <ClipboardList className="size-3.5" />,
        label: "Plan",
        hideLabelOnWrap: true,
        isSelected: (config.mode ?? "agent") !== "agent",
        isDisabled,
        onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
      },
    ];

    const approvalIds = new Set(capabilities.approvalPolicies.map((policy) => policy.id));
    const sandboxIds = new Set(capabilities.sandboxModes.map((mode) => mode.id));
    const permissionPresets = CODEX_PERMISSION_PRESETS.flatMap((preset) => {
      const resolved = resolveCodexPermissionPreset(preset, approvalIds, sandboxIds);
      return resolved ? [{ ...preset, ...resolved }] : [];
    });
    if (permissionPresets.length > 0) {
      const currentPermissionPreset =
        permissionPresets.find(
          (preset) =>
            preset.approvalPolicy === config.approvalPolicy &&
            preset.sandboxMode === config.sandboxMode,
        ) ?? permissionPresets[0]!;
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
      {
        kind: "toggle",
        iconKind: "permission",
        label: "Full Access",
        hideLabelOnWrap: true,
        isSelected: isFullAccess,
        isDisabled,
        onChange: (selected) => {
          if (selected) {
            onConfigChange({ approvalPolicy: "never", sandboxMode: "danger-full-access" });
          } else {
            onConfigChange({
              approvalPolicy: capabilities.approvalPolicies[0]?.id,
              sandboxMode: capabilities.sandboxModes[0]?.id,
            });
          }
        },
      },
    ];
  },
});
