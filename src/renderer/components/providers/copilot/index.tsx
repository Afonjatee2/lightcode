export * from "./CopilotIcon";

import { ClipboardList } from "lucide-react";
import { CopilotIcon } from "./CopilotIcon";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
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

registerComposerControls("copilot", ({ capabilities, config, isDisabled, onConfigChange }) => {
  const hasPlanMode = capabilities.modes.includes("plan");

  const controls: ComposerControl[] = [
    ...(hasPlanMode
      ? [
          {
            kind: "toggle" as const,
            label: "Plan",
            icon: <ClipboardList className="size-3.5" />,
            isSelected: config.mode === "plan",
            hideLabelOnWrap: true,
            isDisabled,
            onChange: (isSelected: boolean) =>
              onConfigChange({ mode: isSelected ? "plan" : "agent" }),
          },
        ]
      : []),
    {
      kind: "toggle" as const,
      label: "Bypass Approvals",
      iconKind: "permission" as const,
      isSelected: (config.approvalPolicy ?? "never") === "never",
      hideLabelOnWrap: true,
      isDisabled,
      onChange: (isSelected: boolean) =>
        onConfigChange({ approvalPolicy: isSelected ? "never" : "default" }),
    },
  ];

  return controls;
});
