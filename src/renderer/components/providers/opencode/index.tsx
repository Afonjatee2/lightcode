export * from "./OpenCodeIcon";

import { OpenCodeIcon } from "./OpenCodeIcon";
import type { ComposerControl } from "@/renderer/components/thread/ThreadComposer";
import { fullAccessToggle, planWorkToggle } from "../composerControlBuilders";
import {
  registerCommitGenDefaults,
  registerComposerControls,
  registerConflictResolverDefaults,
  registerProviderIcon,
  registerProviderLabel,
  registerTitleGenDefaults,
} from "../ProviderIcon";

// `big-pickle` is OpenCode's free always-on house model — every other model
// in `opencode models` is gated behind a user-configured paid provider, so
// it's the only safe out-of-the-box default for commit / title / conflict
// auto-runs. Users can still override per-thread. Supervisor side has its
// own copy at `src/supervisor/agents/opencode/index.ts`; keep them in sync.
const OPENCODE_DEFAULT_MODEL = "opencode/big-pickle";

registerProviderIcon("opencode", OpenCodeIcon);
registerProviderLabel("opencode", "OpenCode");
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

registerComposerControls("opencode", {
  // Plan toggle — wired on both surfaces. GUI threads forward it via
  // `agent: "plan"` on `prompt_async`; TUI threads pass `--agent plan` at
  // launch (see `buildOpenCodeArgs`).
  shared: ({ capabilities, config, isDisabled, onConfigChange }) => {
    const controls: ComposerControl[] = [];
    if (capabilities.modes.includes("plan")) {
      controls.push(
        planWorkToggle({
          isPlanMode: config.mode === "plan",
          isDisabled,
          onChange: (isSelected) => onConfigChange({ mode: isSelected ? "plan" : "agent" }),
        }),
      );
    }
    return controls;
  },
  // Full Access (yolo) is only honored on the GUI surface, where the SDK
  // runtime maps it to an allow-all permission override on `session.create`.
  // Supervised GUI threads omit the override so OpenCode uses its global +
  // project config permissions. The default TUI command (`opencode [project]`)
  // has no equivalent launch flag — the `--dangerously-skip-permissions` flag
  // exists only on `opencode run`. Hide the toggle on terminal threads so it
  // can't be set silently to no effect.
  gui: ({ config, isDisabled, onConfigChange }) => [
    fullAccessToggle({
      isFullAccess: config.approvalPolicy === "yolo",
      isDisabled,
      onChange: (isSelected) => onConfigChange({ approvalPolicy: isSelected ? "yolo" : "default" }),
    }),
  ],
});
