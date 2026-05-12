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
import { AlertTriangle, LogIn } from "lucide-react";
import type { AgentSettingDef, AgentStatus, Project } from "@/shared/contracts";
import { runAgentLoginCommand } from "@/renderer/actions/agentLoginActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { buildWslProjectDistrosKey } from "@/renderer/state/projectKeys";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { readBridge } from "@/renderer/bridge";
import { Select } from "@/renderer/components/common";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
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
          ? `lightcode-menu max-h-[400px] min-w-[280px] overflow-y-auto ${VIRTUALIZED_MENU_DROPDOWN_ITEM_CLASS}`
          : "lightcode-menu max-h-[400px] min-w-[280px] overflow-y-auto"
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

export function formatAgentMetadataSummary(status: AgentStatus): string | undefined {
  const metadata = status.providerMetadata;
  const identityParts: string[] = [];
  if (metadata?.authenticatedAs) identityParts.push(metadata.authenticatedAs);
  if (metadata?.organization) identityParts.push(metadata.organization);
  if (metadata?.plan) identityParts.push(metadata.plan);

  if (identityParts.length > 0) return identityParts.join(" · ");

  const providers = metadata?.connectedProviders ?? [];
  if (providers.length > 0) {
    const labels = providers.map((p) => p.label).join(", ");
    const noun = providers.length === 1 ? "provider" : "providers";
    return `${providers.length} ${noun} · ${labels}`;
  }

  if (metadata?.authMethod) return `via ${metadata.authMethod}`;
  if (status.authState === "authenticated") return "Signed in";
  return undefined;
}

function AgentMetadataLine(props: { status: AgentStatus; showEnvironmentLabel: boolean }) {
  const summary = formatAgentMetadataSummary(props.status);
  if (!summary) return null;
  const prefix = props.showEnvironmentLabel ? `${envLabel(props.status)} · ` : "";
  return <p className="truncate text-xs text-muted">{`${prefix}${summary}`}</p>;
}

function findProjectForAgentStatus(
  status: AgentStatus | undefined,
  projects: readonly Project[],
): Project | undefined {
  if (!status) return undefined;
  if (status.envKind === "wsl" && status.envDistro) {
    return projects.find(
      (project) => project.location.kind === "wsl" && project.location.distro === status.envDistro,
    );
  }
  if (status.envKind === "windows") {
    return projects.find((project) => project.location.kind === "windows");
  }
  return undefined;
}

export function SingleAgentSettings(props: { agentKind: string }) {
  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((s) => s.wslAgentStatuses);
  const projects = useAppStore((state) => state.projects);
  const wslProjectDistrosKey = buildWslProjectDistrosKey(projects);
  const platform = navigator.platform.toLowerCase().includes("win") ? "win32" : "posix";
  const installedHere = agentStatuses.filter((a) => a.kind === props.agentKind && a.installed);
  const installedWsl = wslAgentStatuses.filter((a) => a.kind === props.agentKind && a.installed);
  const installedStatuses = [...installedHere, ...installedWsl];
  const agent = installedHere[0] ?? installedWsl[0];
  const isDisabled = useSharedSettings((s) => s.disabledAgents.includes(props.agentKind));
  const setAgentDisabled = useSharedSettings((s) => s.setAgentDisabled);
  const wslDistros = wslProjectDistrosKey ? wslProjectDistrosKey.split("\0") : [];

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
  const metadataStatuses = installedStatuses.filter(
    (status) => formatAgentMetadataSummary(status) !== undefined,
  );
  const showEnvironmentMetadataLabels = installedStatuses.length > 1;
  const missingAuthStatuses = installedStatuses.filter((status) => status.authState === "missing");
  const loginStatus = missingAuthStatuses.find((status) => status.loginCommand);
  const loginCommand = loginStatus?.loginCommand;
  const loginProject = findProjectForAgentStatus(loginStatus, projects);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <ProviderIcon
              kind={agent.kind}
              icon={agent.icon}
              fallbackLabel={agent.label}
              className="size-5"
            />
            <h1 className="text-lg font-semibold text-foreground">{agent.label}</h1>
          </div>
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
          {metadataStatuses.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {metadataStatuses.map((status, index) => (
                <AgentMetadataLine
                  key={`${status.kind}-${status.envKind ?? "native"}-${status.envDistro ?? index}`}
                  status={status}
                  showEnvironmentLabel={showEnvironmentMetadataLabels}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          {missingAuthStatuses.length > 0 ? (
            <div className="flex items-center justify-between gap-4 rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-warning">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Login required</p>
                  <p className="text-xs text-warning/85">
                    {loginCommand
                      ? `Run ${loginCommand} to sign in.`
                      : "Sign in with the agent CLI, then refresh detected agents."}
                  </p>
                </div>
              </div>
              {loginStatus && loginCommand ? (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() =>
                    runAgentLoginCommand({
                      label: loginStatus.label,
                      command: loginCommand,
                      ...(loginProject ? { project: loginProject } : {}),
                    })
                  }
                >
                  <LogIn className="size-4" />
                  Login
                </Button>
              ) : null}
            </div>
          ) : null}

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
                    .refreshAgentStatuses(wslDistros)
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
