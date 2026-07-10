export * from "./CursorIcon";

import { CursorIcon } from "./CursorIcon";
import providerManifest from "./manifest";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { fullAccessToggle, planWorkToggle } from "../composerControlBuilders";
import { registerProviderIcon } from "../ProviderIcon";
import { registerComposerControls } from "../providerComposer";
import { registerCommitGenDefaults } from "../commitGen";
import { registerConflictResolverDefaults } from "../conflictResolver";
import { registerTitleGenDefaults } from "../titleGen";

const PROVIDER_KIND = providerManifest.kind;

registerProviderIcon(PROVIDER_KIND, CursorIcon);
// `composer-2.5-fast` is Cursor's own default — the cheaper "fast" request tier,
// as quick as plain composer-2.5 at equivalent quality on these utility tasks.
// Cursor's other models are pricier GPT/Claude pass-throughs, so stay on Composer.
registerCommitGenDefaults(PROVIDER_KIND, {
  label: "Cursor",
  hint: "Composer 2.5 Fast",
  model: "composer-2.5-fast",
  effort: "",
});
registerTitleGenDefaults(PROVIDER_KIND, {
  label: "Cursor",
  hint: "Composer 2.5 Fast",
  model: "composer-2.5-fast",
  effort: "",
});
registerConflictResolverDefaults(PROVIDER_KIND, {
  label: "Cursor",
  hint: "Composer 2.5 Fast",
  model: "composer-2.5-fast",
  effort: "",
});

registerComposerControls(PROVIDER_KIND, ({ capabilities, config, isDisabled, onConfigChange }) => {
  const hasPlanMode = capabilities.modes.includes("plan");
  const isPlanMode = config.mode === "plan";
  const isFullAccess = (config.approvalPolicy ?? "default") === "never";

  const controls: ComposerControl[] = [
    ...(hasPlanMode
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
          fullAccessToggle({
            isFullAccess,
            isDisabled,
            onChange: (isSelected) =>
              onConfigChange({ approvalPolicy: isSelected ? "never" : "default" }),
          }),
        ]
      : []),
  ];

  return controls;
});
