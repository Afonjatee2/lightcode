export * from "./AntigravityIcon";

import { AntigravityIcon } from "./AntigravityIcon";
import { planWorkToggle } from "../composerControlBuilders";
import {
  registerComposerControls,
  registerProviderIcon,
  registerProviderLabel,
} from "../ProviderIcon";

registerProviderIcon("antigravity", AntigravityIcon);
registerProviderLabel("antigravity", "Antigravity");

registerComposerControls("antigravity", ({ capabilities, config, isDisabled, onConfigChange }) => {
  const isPlanMode = (config.mode ?? "agent") !== "agent";
  return [
    ...(capabilities.modes.length === 2
      ? [
          planWorkToggle({
            isPlanMode,
            isDisabled,
            onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
          }),
        ]
      : []),
    ...(capabilities.approvalPolicies.length > 0
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
