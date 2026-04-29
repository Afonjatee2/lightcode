export * from "./OpenCodeIcon";

import { OpenCodeIcon } from "./OpenCodeIcon";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerTitleGenDefaults,
} from "../ProviderIcon";
import { withCurrentModel } from "@/renderer/components/thread/threadComposerOptions";

// `big-pickle` is OpenCode's free always-on house model — every other model
// in `opencode models` is gated behind a user-configured paid provider, so
// it's the only safe out-of-the-box default for commit / title / conflict
// auto-runs. Users can still override per-thread. Supervisor side has its
// own copy at `src/supervisor/agents/opencode/index.ts`; keep them in sync.
const OPENCODE_DEFAULT_MODEL = "opencode/big-pickle";

registerProviderIcon("opencode", OpenCodeIcon);
registerCommitGenDefaults("opencode", {
  label: "OpenCode",
  hint: "Big Pickle",
  model: OPENCODE_DEFAULT_MODEL,
  effort: "",
});
registerTitleGenDefaults("opencode", {
  label: "OpenCode",
  hint: "Big Pickle",
  model: OPENCODE_DEFAULT_MODEL,
  effort: "",
});
registerConflictResolverDefaults("opencode", {
  label: "OpenCode",
  hint: "Big Pickle",
  model: OPENCODE_DEFAULT_MODEL,
  effort: "",
});

registerComposerControls("opencode", ({ capabilities, config, isDisabled, onConfigChange }) => [
  {
    options: withCurrentModel(capabilities.models, config.model),
    value: config.model,
    isDisabled,
    onChange: (value: string) => onConfigChange({ model: value }),
  },
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
]);
