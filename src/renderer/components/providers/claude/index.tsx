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

registerProviderIcon("claude", ClaudeIcon);
registerCommitGenDefaults("claude", { label: "Claude", hint: "Haiku", model: "haiku", effort: "" });
registerTitleGenDefaults("claude", { label: "Claude", hint: "Haiku", model: "haiku", effort: "" });
registerConflictResolverDefaults("claude", {
  label: "Claude",
  hint: "Opus 4.7",
  model: "claude-opus-4-7",
  effort: "",
});

registerComposerControls("claude", ({ capabilities, config, isDisabled, onConfigChange }) => {
  return [
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
            value:
              config.approvalPolicy ??
              capabilities.bypassApprovalPolicy ??
              capabilities.approvalPolicies[0]?.id ??
              "default",
            isDisabled,
            onChange: (value: string) => onConfigChange({ approvalPolicy: value }),
          },
        ]
      : []),
  ];
});
