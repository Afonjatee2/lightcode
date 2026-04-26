import { startTransition } from "react";
import { Switch } from "@heroui/react";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

export function DevSettings() {
  const disableCliHookPlugin = useSharedSettings((state) => state.disableCliHookPlugin);
  const setDisableCliHookPlugin = useSharedSettings((state) => state.setDisableCliHookPlugin);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-2 text-lg font-semibold text-foreground">Dev</h1>
        <p className="mb-6 text-xs text-muted">
          Development-only overrides. Only visible in the LIGHTCODE DEV build.
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Disable CLI hook plugin (L1)</p>
              <p className="text-xs text-muted">
                Drops incoming hook envelopes on the supervisor so agents fall back to L2 (OSC 9;4
                progress) without touching install or iTerm2 notifications. Takes effect on the next
                hook event — no restart needed.
              </p>
            </div>
            <Switch
              isSelected={disableCliHookPlugin}
              onChange={(selected) => {
                startTransition(() => {
                  setDisableCliHookPlugin(selected);
                });
              }}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        </div>
      </div>
    </div>
  );
}
