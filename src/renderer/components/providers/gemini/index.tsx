export * from "./GeminiIcon";

import { GeminiIcon } from "./GeminiIcon";
import { planWorkToggle } from "../composerControlBuilders";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerProviderLabel,
  registerTitleGenDefaults,
} from "../ProviderIcon";

registerProviderIcon("gemini", GeminiIcon);
registerProviderLabel("gemini", "Gemini");
registerCommitGenDefaults("gemini", {
  label: "Gemini",
  hint: "3 Flash",
  model: "gemini-3-flash",
  effort: "",
});
registerTitleGenDefaults("gemini", {
  label: "Gemini",
  hint: "3.1 Flash Lite",
  model: "gemini-3.1-flash-lite",
  effort: "",
});
registerConflictResolverDefaults("gemini", {
  label: "Gemini",
  hint: "3.1 Pro",
  model: "gemini-3.1-pro",
  effort: "",
});

registerComposerControls("gemini", ({ capabilities, config, isDisabled, onConfigChange }) => {
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
