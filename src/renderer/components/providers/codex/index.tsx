export * from "./CodexStatusIcon";

import { ClipboardList } from "lucide-react";
import { CodexStatusIcon } from "./CodexStatusIcon";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerTitleGenDefaults,
} from "../ProviderIcon";
import { withCurrentModel } from "@/renderer/components/thread/threadComposerOptions";

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

registerComposerControls("codex", ({ capabilities, config, isDisabled, onConfigChange }) => {
  const availableEfforts =
    capabilities.modelEfforts?.[config.model ?? ""] ?? capabilities.efforts ?? [];
  const hasPermissions =
    capabilities.approvalPolicies.length > 0 || capabilities.sandboxModes.length > 0;
  const isFullAccess =
    config.approvalPolicy === "never" && config.sandboxMode === "danger-full-access";

  return [
    // Model
    {
      options: withCurrentModel(capabilities.models, config.model),
      value: config.model,
      isDisabled,
      onChange: (value: string) => {
        const nextEfforts = capabilities.modelEfforts?.[value] ?? capabilities.efforts ?? [];
        const effortValid = nextEfforts.includes(config.effort ?? "");
        onConfigChange({
          model: value,
          ...(!effortValid && nextEfforts.length > 0 ? { effort: nextEfforts[0] } : {}),
        });
      },
    },
    // Effort
    ...(availableEfforts.length > 0
      ? [
          {
            iconKind: "effort" as const,
            options: availableEfforts.map((value) => ({
              id: value,
              label: value.charAt(0).toUpperCase() + value.slice(1),
            })),
            value: config.effort ?? availableEfforts[0] ?? "",
            hideLabelOnWrap: true,
            isDisabled,
            onChange: (value: string) => onConfigChange({ effort: value }),
          },
        ]
      : []),
    // Plan toggle
    ...(capabilities.modes.length === 2
      ? [
          {
            kind: "toggle" as const,
            icon: <ClipboardList className="size-3.5" />,
            label: "Plan",
            hideLabelOnWrap: true,
            isSelected: (config.mode ?? "agent") !== "agent",
            isDisabled,
            onChange: (isSelected: boolean) =>
              onConfigChange({ mode: isSelected ? "plan" : "agent" }),
          },
        ]
      : []),
    // Approval/sandbox — Full Access toggle (Codex couples both fields)
    ...(hasPermissions
      ? [
          {
            kind: "toggle" as const,
            iconKind: "permission" as const,
            label: "Full Access",
            hideLabelOnWrap: true,
            isSelected: isFullAccess,
            isDisabled,
            onChange: (selected: boolean) => {
              if (selected) {
                onConfigChange({
                  approvalPolicy: "never",
                  sandboxMode: "danger-full-access",
                });
              } else {
                onConfigChange({
                  approvalPolicy: capabilities.approvalPolicies[0]?.id,
                  sandboxMode: capabilities.sandboxModes[0]?.id,
                });
              }
            },
          },
        ]
      : []),
  ];
});
