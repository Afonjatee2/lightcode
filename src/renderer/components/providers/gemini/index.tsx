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
  hint: "Flash",
  model: "gemini-2.5-flash",
  effort: "",
});
registerTitleGenDefaults("gemini", {
  label: "Gemini",
  hint: "Flash Lite",
  model: "gemini-2.5-flash-lite",
  effort: "",
});
registerConflictResolverDefaults("gemini", {
  label: "Gemini",
  hint: "Auto",
  model: "",
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
