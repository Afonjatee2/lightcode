export * from "./ClaudeIcon";

import { ClipboardList } from "lucide-react";
import { ClaudeIcon } from "./ClaudeIcon";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerTitleGenDefaults,
} from "../ProviderIcon";
import { withCurrentModel } from "@/renderer/components/thread/threadComposerOptions";

registerProviderIcon("claude", ClaudeIcon);
registerCommitGenDefaults("claude", { label: "Claude", hint: "Haiku", model: "haiku", effort: "" });
registerTitleGenDefaults("claude", { label: "Claude", hint: "Haiku", model: "haiku", effort: "" });
registerConflictResolverDefaults("claude", {
  label: "Claude",
  hint: "Opus 4.7",
  model: "claude-opus-4-7[1m]",
  effort: "",
});

const MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-7": "claude-opus-4-7[1m]",
  "claude-opus-4-6": "claude-opus-4-6[1m]",
};

function normalizeModel(id: string, models: readonly { id: string }[]): string {
  if (models.some((m) => m.id === id)) return id;
  return MODEL_ALIASES[id] ?? id;
}

registerComposerControls("claude", ({ capabilities, config, isDisabled, onConfigChange }) => {
  const model = normalizeModel(config.model ?? "", capabilities.models);
  const availableEfforts = capabilities.modelEfforts?.[model] ?? capabilities.efforts ?? [];

  return [
    // Model
    {
      options: withCurrentModel(capabilities.models, model),
      value: model,
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
    // Approval policy (hidden when plan mode overrides it)
    ...(capabilities.approvalPolicies.length > 0 && (config.mode ?? "agent") === "agent"
      ? [
          {
            iconKind: "permission" as const,
            options: capabilities.approvalPolicies,
            hideLabelOnWrap: true,
            value: config.approvalPolicy ?? capabilities.approvalPolicies[0]?.id ?? "default",
            isDisabled,
            onChange: (value: string) => onConfigChange({ approvalPolicy: value }),
          },
        ]
      : []),
  ];
});
