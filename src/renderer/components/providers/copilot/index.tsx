export * from "./CopilotIcon";

import { CopilotIcon } from "./CopilotIcon";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import type { ThreadConfig } from "@/shared/contracts";
import { fullAccessToggle, planWorkToggle } from "../composerControlBuilders";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerProviderLabel,
  registerTitleGenDefaults,
} from "../ProviderIcon";

registerProviderIcon("copilot", CopilotIcon);
registerProviderLabel("copilot", "Copilot");
registerCommitGenDefaults("copilot", {
  label: "Copilot",
  hint: "first available model",
  model: "",
  effort: "low",
});
registerTitleGenDefaults("copilot", {
  label: "Copilot",
  hint: "first available model",
  model: "",
  effort: "low",
});
registerConflictResolverDefaults("copilot", {
  label: "Copilot",
  hint: "first available model",
  model: "",
  effort: "",
});

// Copilot calls the unrestricted state "Autopilot" in its CLI/docs, but the
// composer uses the shared permission wording across providers.
function copilotPermissionToggle({
  config,
  isDisabled,
  onConfigChange,
}: {
  config: ThreadConfig;
  isDisabled: boolean;
  onConfigChange: (patch: Partial<ThreadConfig>) => void;
}): ComposerControl {
  return fullAccessToggle({
    isFullAccess: (config.approvalPolicy ?? "never") === "never",
    isDisabled,
    onChange: (isSelected) => onConfigChange({ approvalPolicy: isSelected ? "never" : "default" }),
  });
}

registerComposerControls("copilot", {
  // Plan toggle is shared: ACP exposes it as a session mode and the CLI maps
  // it to a `/plan` slash-command prefix. Both surfaces accept the same
  // `mode: "plan"` config value.
  shared: ({ capabilities, config, isDisabled, onConfigChange }) =>
    capabilities.modes.includes("plan")
      ? [
          planWorkToggle({
            isPlanMode: config.mode === "plan",
            isDisabled,
            onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
          }),
        ]
      : [],
  // ACP exposes Plan/Agent/Autopilot as a single mutually-exclusive
  // session-mode field. Full access is now visible even while Plan is on
  // so users can pre-configure it; the runtime handles mapping this
  // to the correct implementation mode upon plan approval.
  gui: ({ config, isDisabled, onConfigChange }) => [
    copilotPermissionToggle({ config, isDisabled, onConfigChange }),
  ],
  // CLI: `/plan` and `--yolo` are independent flags, so full access is always
  // available regardless of Plan state.
  terminal: ({ config, isDisabled, onConfigChange }) => [
    copilotPermissionToggle({ config, isDisabled, onConfigChange }),
  ],
});
