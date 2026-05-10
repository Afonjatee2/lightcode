export * from "./CopilotIcon";

import { ClipboardList } from "lucide-react";
import { CopilotIcon } from "./CopilotIcon";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import type { ThreadConfig } from "@/shared/contracts";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerTitleGenDefaults,
} from "../ProviderIcon";

registerProviderIcon("copilot", CopilotIcon);
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

// Copilot calls this "Autopilot" in its CLI/docs (`--yolo` flag, `autopilot`
// ACP session mode). We surface Copilot's own terminology rather than the
// generic "Bypass Approvals" label other adapters use.
function copilotAutopilotToggle({
  config,
  isDisabled,
  onConfigChange,
}: {
  config: ThreadConfig;
  isDisabled: boolean;
  onConfigChange: (patch: Partial<ThreadConfig>) => void;
}): ComposerControl {
  return {
    kind: "toggle",
    label: "Autopilot",
    iconKind: "permission",
    isSelected: (config.approvalPolicy ?? "never") === "never",
    hideLabelOnWrap: true,
    isDisabled,
    onChange: (isSelected) => onConfigChange({ approvalPolicy: isSelected ? "never" : "default" }),
  };
}

registerComposerControls("copilot", {
  // Plan toggle is shared: ACP exposes it as a session mode and the CLI maps
  // it to a `/plan` slash-command prefix. Both surfaces accept the same
  // `mode: "plan"` config value.
  shared: ({ capabilities, config, isDisabled, onConfigChange }) =>
    capabilities.modes.includes("plan")
      ? [
          {
            kind: "toggle",
            label: "Plan",
            icon: <ClipboardList className="size-3.5" />,
            isSelected: config.mode === "plan",
            hideLabelOnWrap: true,
            isDisabled,
            onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
          },
        ]
      : [],
  // ACP exposes Plan/Agent/Autopilot as a single mutually-exclusive
  // session-mode field. Autopilot is now visible even while Plan is on
  // so users can pre-configure it; the runtime handles mapping this
  // to the correct implementation mode upon plan approval.
  gui: ({ config, isDisabled, onConfigChange }) => [
    copilotAutopilotToggle({ config, isDisabled, onConfigChange }),
  ],
  // CLI: `/plan` and `--yolo` are independent flags, so Autopilot is always
  // available regardless of Plan state.
  terminal: ({ config, isDisabled, onConfigChange }) => [
    copilotAutopilotToggle({ config, isDisabled, onConfigChange }),
  ],
});
