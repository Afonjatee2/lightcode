import { startTransition } from "react";
import { Button, Dropdown, Label, Switch } from "@heroui/react";
import type { Selection } from "@heroui/react";
import type { AgentSettingDef } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { readBridge } from "@/renderer/bridge";
import { Select } from "@/renderer/components/common";

function AgentSettingRow(props: { agentKind: string; def: AgentSettingDef }) {
  const { agentKind, def } = props;
  const value = useSharedSettings((s) => s.agentSettings[agentKind]?.[def.key] ?? def.default);
  const setAgentSetting = useSharedSettings((s) => s.setAgentSetting);

  if (def.type !== "toggle" && def.type !== "select") return null;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{def.label}</p>
        <p className="text-xs text-muted">{def.description}</p>
      </div>
      {def.type === "toggle" ? (
        <Switch
          isSelected={value as boolean}
          onChange={(selected) => {
            startTransition(() => {
              setAgentSetting(agentKind, def.key, selected);
            });
          }}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      ) : (
        <Select
          aria-label={def.label}
          className="w-[160px] shrink-0"
          options={def.options}
          value={String(value)}
          onChange={(v) => {
            startTransition(() => {
              setAgentSetting(agentKind, def.key, v);
            });
          }}
        />
      )}
    </div>
  );
}

function ModelVisibilityDropdown(props: {
  agentKind: string;
  models: readonly { id: string; label: string }[];
}) {
  const { agentKind, models } = props;
  const hiddenIds = useSharedSettings((s) => s.hiddenModels[agentKind]);
  const setHiddenModels = useSharedSettings((s) => s.setHiddenModels);

  const hidden = hiddenIds ?? [];
  const hiddenSet = new Set(hidden);
  const visibleKeys: Selection = new Set(
    models.filter((m) => !hiddenSet.has(m.id)).map((m) => m.id),
  );
  const hiddenCount = hidden.length;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Visible models</p>
        <p className="text-xs text-muted">Toggle models off to hide them from the selector.</p>
      </div>
      <Dropdown>
        <Button variant="secondary" size="sm" className="min-w-[4.5rem] tabular-nums">
          {models.length - hiddenCount} / {models.length}
        </Button>
        <Dropdown.Popover className="min-w-[280px]">
          <Dropdown.Menu
            className="max-h-[400px] overflow-y-auto"
            selectedKeys={visibleKeys}
            selectionMode="multiple"
            onSelectionChange={(keys) => {
              const selected =
                keys === "all" ? new Set(models.map((m) => m.id)) : (keys as Set<string>);
              const nextHidden = models.filter((m) => !selected.has(m.id)).map((m) => m.id);
              setHiddenModels(agentKind, nextHidden);
            }}
          >
            {models.map((m) => (
              <Dropdown.Item key={m.id} id={m.id} textValue={m.label}>
                <Dropdown.ItemIndicator />
                <Label>{m.label}</Label>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

export function SingleAgentSettings(props: { agentKind: string }) {
  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const platform = navigator.platform.toLowerCase().includes("win") ? "win32" : "posix";
  const agent = agentStatuses.find((a) => a.kind === props.agentKind && a.installed);
  const isDisabled = useSharedSettings((s) => s.disabledAgents.includes(props.agentKind));
  const setAgentDisabled = useSharedSettings((s) => s.setAgentDisabled);

  if (!agent) {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-6 pb-8">
        <div className="mx-auto max-w-[560px]">
          <h1 className="mb-6 text-lg font-semibold text-foreground">Agent not found</h1>
          <p className="text-sm text-muted">This agent is not installed.</p>
        </div>
      </div>
    );
  }

  const defs = (agent.capabilities.settingDefs ?? []).filter(
    (def) => !def.platforms || def.platforms.includes(platform),
  );
  const models = agent.capabilities.models.filter((m) => m.id !== "auto");

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8">
      <div className="mx-auto max-w-[560px]">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground">{agent.label}</h1>
          {agent.version && <p className="mt-0.5 text-xs text-muted">v{agent.version}</p>}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Enabled</p>
              <p className="text-xs text-muted">
                Show this agent in the agent picker when creating threads.
              </p>
            </div>
            <Switch
              isSelected={!isDisabled}
              onChange={(selected) => {
                startTransition(() => {
                  setAgentDisabled(agent.kind, !selected);
                });
                if (selected) {
                  void readBridge()
                    .getAgentStatuses()
                    .catch(() => undefined);
                }
              }}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        </div>

        <div className={`transition-opacity ${isDisabled ? "pointer-events-none opacity-40" : ""}`}>
          {defs.length > 0 && (
            <div className="mt-8 space-y-4">
              {defs.map((def) => (
                <AgentSettingRow key={def.key} agentKind={agent.kind} def={def} />
              ))}
            </div>
          )}

          {models.length > 0 && (
            <div className="mt-8 space-y-4">
              <ModelVisibilityDropdown agentKind={agent.kind} models={models} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentSettingsEmpty() {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8">
      <div className="mx-auto max-w-[560px]">
        <h1 className="mb-6 text-lg font-semibold text-foreground">Agents</h1>
        <p className="text-sm text-muted">No agents installed.</p>
      </div>
    </div>
  );
}
