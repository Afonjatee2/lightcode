import { startTransition } from "react";
import {
  Button,
  Label,
  ListBox,
  ListLayout,
  Popover,
  Switch,
  type Selection,
  Virtualizer,
} from "@heroui/react";
import type { AgentSettingDef, AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { readBridge } from "@/renderer/bridge";
import { Select } from "@/renderer/components/common";
import {
  LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD,
  MENU_DROPDOWN_ROW_HEIGHT,
  VIRTUALIZED_MENU_DROPDOWN_ITEM_CLASS,
} from "@/renderer/components/common/dropdownVirtualization";

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
  const isVirtualized = models.length > LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD;
  const listBox = (
    <ListBox
      aria-label="Visible models"
      className={
        isVirtualized
          ? `max-h-[400px] min-w-[280px] overflow-y-auto !m-0 !p-0 ${VIRTUALIZED_MENU_DROPDOWN_ITEM_CLASS} [&_.list-box-item]:py-1 [&_.list-box-item]:pl-2 [&_.list-box-item]:pr-2`
          : "max-h-[400px] min-w-[280px] overflow-y-auto !m-0 !p-1 [&_.list-box-item]:min-h-8 [&_.list-box-item]:py-1 [&_.list-box-item]:pl-2 [&_.list-box-item]:pr-2"
      }
      items={models}
      selectedKeys={visibleKeys}
      selectionMode="multiple"
      onSelectionChange={(keys) => {
        const selected = keys === "all" ? new Set(models.map((m) => m.id)) : (keys as Set<string>);
        const nextHidden = models.filter((m) => !selected.has(m.id)).map((m) => m.id);
        setHiddenModels(agentKind, nextHidden);
      }}
    >
      {(model) => (
        <ListBox.Item id={model.id} textValue={model.label} className="focus-visible:outline-none">
          <ListBox.ItemIndicator />
          <Label className="flex-1 truncate">{model.label}</Label>
        </ListBox.Item>
      )}
    </ListBox>
  );

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Visible models</p>
        <p className="text-xs text-muted">Toggle models off to hide them from the selector.</p>
      </div>
      <Popover>
        <Popover.Trigger>
          <Button variant="secondary" size="sm" className="min-w-[4.5rem] tabular-nums">
            {models.length - hiddenCount} / {models.length}
          </Button>
        </Popover.Trigger>
        <Popover.Content className="p-0">
          <Popover.Dialog className="overflow-hidden">
            {isVirtualized ? (
              <Virtualizer
                layout={ListLayout}
                layoutOptions={{ padding: 4, rowHeight: MENU_DROPDOWN_ROW_HEIGHT }}
              >
                {listBox}
              </Virtualizer>
            ) : (
              listBox
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}

function envLabel(status: AgentStatus): string {
  if (status.envKind === "wsl") return status.envDistro ? `WSL (${status.envDistro})` : "WSL";
  if (status.envKind === "windows") return "Windows";
  return "";
}

export function SingleAgentSettings(props: { agentKind: string }) {
  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((s) => s.wslAgentStatuses);
  const platform = navigator.platform.toLowerCase().includes("win") ? "win32" : "posix";
  const installedHere = agentStatuses.filter((a) => a.kind === props.agentKind && a.installed);
  const installedWsl = wslAgentStatuses.filter((a) => a.kind === props.agentKind && a.installed);
  const agent = installedHere[0] ?? installedWsl[0];
  const isDisabled = useSharedSettings((s) => s.disabledAgents.includes(props.agentKind));
  const setAgentDisabled = useSharedSettings((s) => s.setAgentDisabled);

  if (!agent) {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
        <div className="mx-auto max-w-[720px]">
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

  const versionRows: { label: string; version: string | undefined }[] = [];
  if (platform === "win32") {
    for (const s of installedHere) versionRows.push({ label: envLabel(s), version: s.version });
    for (const s of installedWsl) versionRows.push({ label: envLabel(s), version: s.version });
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground">{agent.label}</h1>
          {versionRows.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {versionRows.map((row, i) => (
                <div key={`${row.label}-${i}`} className="flex gap-2 text-xs text-muted">
                  <span className="w-[120px] shrink-0">{row.label}</span>
                  <span className="tabular-nums">{row.version ? `v${row.version}` : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            agent.version && <p className="mt-0.5 text-xs text-muted">v{agent.version}</p>
          )}
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
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-6 text-lg font-semibold text-foreground">Agents</h1>
        <p className="text-sm text-muted">No agents installed.</p>
      </div>
    </div>
  );
}
