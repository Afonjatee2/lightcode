import { Switch } from "@heroui/react";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

export function BrowserSettings() {
  const mcpEnabled = useSharedSettings((s) => s.browser.mcpEnabled);
  const allowEval = useSharedSettings((s) => s.browser.allowEval);
  const allowDataAccess = useSharedSettings((s) => s.browser.allowDataAccess);
  const setBrowserSetting = useSharedSettings((s) => s.setBrowserSetting);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-2 text-lg font-semibold text-foreground">Browser</h1>
        <p className="mb-6 text-xs text-muted">
          The in-app browser lives in the right panel. When the MCP server is enabled, agents you
          launch can navigate, click, type, query the DOM, and take screenshots inside this panel.
          The browser keeps running in the background even when the panel is hidden.
        </p>

        <div className="space-y-4">
          <SettingRow
            title="Expose browser to agents (MCP)"
            description="Newly launched agents will see navigate, click, screenshot, etc. Existing live agents keep their current configuration until restarted."
            value={mcpEnabled}
            onChange={(v) => setBrowserSetting("mcpEnabled", v)}
          />
          <SettingRow
            title="Allow eval"
            description={
              <>
                Lets agents call <code>eval</code> to run arbitrary JavaScript inside the embedded
                page. Off by default — turn on only when you trust the loaded sites and the agent.
              </>
            }
            value={allowEval}
            onChange={(v) => setBrowserSetting("allowEval", v)}
            disabled={!mcpEnabled}
          />
          <SettingRow
            title="Allow agents to read/write cookies and storage"
            description={
              <>
                Enables <code>cookies</code> and <code>storage</code>. Cookies can contain session
                tokens and storage often holds auth state — only enable when you trust both the
                agent and the sites it visits.
              </>
            }
            value={allowDataAccess}
            onChange={(v) => setBrowserSetting("allowDataAccess", v)}
            disabled={!mcpEnabled}
          />
        </div>
      </div>
    </div>
  );
}

function SettingRow(props: {
  title: string;
  description: React.ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-[var(--surface-background,#0d1117)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{props.title}</div>
        <div className="mt-1 text-xs text-muted">{props.description}</div>
      </div>
      <Switch
        isSelected={props.value}
        isDisabled={props.disabled === true}
        onChange={(selected) => props.onChange(selected)}
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    </div>
  );
}
