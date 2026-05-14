import { startTransition, useEffect, useState } from "react";
import {
  Button,
  Label,
  ListBox,
  ListLayout,
  Popover,
  Switch,
  toast,
  type Selection,
  Virtualizer,
} from "@heroui/react";
import { AlertTriangle, ArrowUpCircle, LogIn, LogOut, Save } from "lucide-react";
import type {
  AgentEnvVarAuthMethod,
  AgentOwnedAuthMethod,
  AgentSettingDef,
  AgentStatus,
  Project,
  RefreshAgentScopeEnv,
} from "@/shared/contracts";
import { runAgentLoginCommand } from "@/renderer/actions/agentLoginActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { buildWslProjectDistrosKey } from "@/renderer/state/projectKeys";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { readBridge } from "@/renderer/bridge";
import { Input, Select } from "@/renderer/components/common";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import {
  LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD,
  MENU_DROPDOWN_ROW_HEIGHT,
  VIRTUALIZED_MENU_DROPDOWN_ITEM_CLASS,
} from "@/renderer/components/common/dropdownVirtualization";

const SAVED_SECRET_MASK = "***********";

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

function formatAgentMetadataSummary(
  status: AgentStatus,
  options?: { includeAuthFallback?: boolean },
): string | undefined {
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

  if (options?.includeAuthFallback === false) return undefined;
  if (metadata?.authMethod) return `via ${metadata.authMethod}`;
  if (status.authState === "authenticated") return "Signed in";
  return undefined;
}

function AgentMetadataLine(props: {
  status: AgentStatus;
  showEnvironmentLabel: boolean;
  includeAuthFallback: boolean;
}) {
  const summary = formatAgentMetadataSummary(props.status, {
    includeAuthFallback: props.includeAuthFallback,
  });
  if (!summary) return null;
  const prefix = props.showEnvironmentLabel ? `${envLabel(props.status)} · ` : "";
  return <p className="truncate text-xs text-muted">{`${prefix}${summary}`}</p>;
}

function formatStatusList(statuses: readonly AgentStatus[]): string {
  return statuses
    .map((status) => envLabel(status))
    .filter((label) => label.length > 0)
    .join(", ");
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

function acpGenericInstanceId(kind: string): string | undefined {
  return kind.startsWith("acp-generic:") ? kind.slice("acp-generic:".length) : undefined;
}

type StatusAuthMethod = NonNullable<AgentStatus["authMethods"]>[number];

function isEnvVarAuthMethod(method: StatusAuthMethod | undefined): method is AgentEnvVarAuthMethod {
  return (
    method !== undefined &&
    (method.type === "env_var" || ("vars" in method && Array.isArray(method.vars)))
  );
}

function isAgentAuthMethod(method: StatusAuthMethod | undefined): method is AgentOwnedAuthMethod {
  return method !== undefined && !isEnvVarAuthMethod(method) && method.type !== "terminal";
}

function findEnvVarAuthMethod(statuses: readonly AgentStatus[]): AgentEnvVarAuthMethod | undefined {
  for (const status of statuses) {
    const method = status.authMethods?.find(isEnvVarAuthMethod);
    if (method) return method;
  }
  return undefined;
}

function findAgentAuthMethod(
  statuses: readonly AgentStatus[],
): { status: AgentStatus; method: AgentOwnedAuthMethod } | undefined {
  for (const status of statuses) {
    const method = status.authMethods?.find(isAgentAuthMethod);
    if (method) return { status, method };
  }
  return undefined;
}

function agentAuthTarget(status: AgentStatus) {
  return {
    ...(status.envKind ? { envKind: status.envKind } : {}),
    ...(status.envDistro ? { wslDistro: status.envDistro } : {}),
  };
}

function scopeEnvForStatus(status: AgentStatus): RefreshAgentScopeEnv {
  return status.envKind === "wsl" && status.envDistro
    ? { kind: "wsl", distro: status.envDistro }
    : { kind: "native" };
}

function findTerminalLoginStatus(statuses: readonly AgentStatus[]): AgentStatus | undefined {
  return statuses.find(
    (status) =>
      status.loginCommand && status.authMethods?.some((candidate) => candidate.type === "terminal"),
  );
}

function statusEnvKey(status: AgentStatus): string {
  return status.envKind === "wsl" && status.envDistro ? `wsl:${status.envDistro}` : "native";
}

function AcpAgentAuthEnvRow(props: {
  status: AgentStatus;
  agentAuthMethod: AgentOwnedAuthMethod | undefined;
  authPending: boolean;
  pendingMessage: string | undefined;
  showEnvironmentLabel: boolean;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const { status, agentAuthMethod, showEnvironmentLabel } = props;
  const isMissing = status.authState === "missing";
  const isAuthenticated = status.authState === "authenticated";
  const env = envLabel(status);
  const envSuffix = showEnvironmentLabel && env ? ` ${env}` : "";
  const envScope = env ? ` for ${env}` : "";
  const envSubject = env || "Agent";
  const canLogin = isMissing && agentAuthMethod !== undefined;
  const canLogout = isAuthenticated;
  const headerLabel = isMissing
    ? "Login required"
    : isAuthenticated
      ? "Signed in"
      : "Authentication";
  const headerPrefix = env ? `${env} · ` : "";
  const description = isMissing
    ? agentAuthMethod
      ? `Complete ${agentAuthMethod.name} sign-in${envScope}.`
      : `${envSubject} needs authentication.`
    : isAuthenticated
      ? `${envSubject} credentials are configured.`
      : "";

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${isMissing ? "text-warning" : ""}`}>
            {isMissing ? (
              <AlertTriangle className="mr-1.5 inline size-4 -translate-y-px text-warning" />
            ) : null}
            {headerPrefix}
            {headerLabel}
          </p>
          {description ? <p className="text-xs text-muted">{description}</p> : null}
          {props.pendingMessage ? (
            <p className="mt-1 text-xs text-muted">{props.pendingMessage}</p>
          ) : null}
        </div>
      </div>
      {canLogin || canLogout ? (
        <div className="flex shrink-0 flex-row items-center gap-2">
          {canLogin ? (
            <Button
              size="sm"
              variant="tertiary"
              isIconOnly
              aria-label={`Login${envSuffix}`}
              isPending={props.authPending}
              onPress={props.onLogin}
            >
              <LogIn className="size-4" />
            </Button>
          ) : null}
          {canLogout ? (
            <Button
              size="sm"
              variant="tertiary"
              isIconOnly
              aria-label={`Logout${envSuffix}`}
              isPending={props.authPending}
              onPress={props.onLogout}
            >
              <LogOut className="size-4 text-danger" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SingleAgentSettings(props: { agentKind: string }) {
  const [authValues, setAuthValues] = useState<Record<string, string>>({});
  const [authPending, setAuthPending] = useState(false);
  const [authPendingMessage, setAuthPendingMessage] = useState<string | undefined>();
  const [authPendingEnvKey, setAuthPendingEnvKey] = useState<string | undefined>();
  const [latestRegistryVersion, setLatestRegistryVersion] = useState<string | undefined>();
  const [updatePending, setUpdatePending] = useState(false);
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
  const installedRegistryRecord = useSharedSettings(
    (s) => s.acpRegistryInstalledAgents[acpGenericInstanceId(props.agentKind) ?? ""],
  );
  const wslDistros = wslProjectDistrosKey ? wslProjectDistrosKey.split("\0") : [];

  const registryAgentId = acpGenericInstanceId(props.agentKind);
  useEffect(() => {
    if (!registryAgentId) return;
    let cancelled = false;
    readBridge()
      .listAcpRegistry()
      .then((result) => {
        if (cancelled) return;
        const match = result.agents.find((entry) => entry.id === registryAgentId);
        setLatestRegistryVersion(match?.version);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [registryAgentId]);

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
  const showEnvironmentMetadataLabels = installedStatuses.length > 1;
  const missingAuthStatuses = installedStatuses.filter((status) => status.authState === "missing");
  const envVarAuthMethod =
    findEnvVarAuthMethod(installedStatuses) ?? findEnvVarAuthMethod(missingAuthStatuses);
  const agentAuthStatuses =
    missingAuthStatuses.length > 0 ? missingAuthStatuses : installedStatuses;
  const agentAuthEntries = agentAuthStatuses.flatMap((status) => {
    const method = status.authMethods?.find(isAgentAuthMethod);
    return method ? [{ status, method }] : [];
  });
  const agentAuth = findAgentAuthMethod(agentAuthStatuses);
  const terminalLoginStatus =
    findTerminalLoginStatus(installedStatuses) ??
    missingAuthStatuses.find((status) => status.loginCommand);
  const loginStatus =
    terminalLoginStatus ?? missingAuthStatuses.find((status) => status.loginCommand);
  const loginCommand = loginStatus?.loginCommand;
  const loginProject = findProjectForAgentStatus(loginStatus, projects);
  const acpInstanceId = acpGenericInstanceId(agent.kind);
  const logoutStatuses = installedStatuses.filter(
    (status) =>
      status.authState === "authenticated" &&
      (status.authLogoutSupported === true || acpInstanceId !== undefined),
  );
  const requiredAuthVars = envVarAuthMethod?.vars.filter((variable) => variable.optional !== true);
  const canSaveEnvAuth =
    acpInstanceId !== undefined &&
    requiredAuthVars?.every((variable) => authValues[variable.name]?.trim()) === true;
  const saveEnvAuth = () => {
    if (!envVarAuthMethod || !acpInstanceId || !canSaveEnvAuth) return;
    const environment = Object.fromEntries(
      envVarAuthMethod.vars.flatMap((variable) => {
        const value = authValues[variable.name]?.trim();
        return value ? [[variable.name, value]] : [];
      }),
    );
    setAuthPending(true);
    readBridge()
      .setAcpRegistryAgentAuth({ agentId: acpInstanceId, environment })
      .then(() => readBridge().refreshAgentStatuses(wslDistros, { agentKinds: [props.agentKind] }))
      .then(() => {
        setAuthValues({});
        toast.success(`${agent.label} credentials saved.`);
      })
      .catch((error) =>
        toast.danger(
          error instanceof Error ? error.message : `Unable to save ${agent.label} credentials.`,
        ),
      )
      .finally(() => setAuthPending(false));
  };
  const authenticateAgent = (auth = agentAuth) => {
    if (!auth || !acpInstanceId) return;
    setAuthPending(true);
    setAuthPendingEnvKey(statusEnvKey(auth.status));
    setAuthPendingMessage(
      `Waiting for ${envLabel(auth.status) ? `${envLabel(auth.status)} ` : ""}${auth.method.name} authentication. Detected agents will refresh when it finishes.`,
    );
    readBridge()
      .authenticateAcpRegistryAgent({
        agentId: acpInstanceId,
        methodId: auth.method.id,
        ...agentAuthTarget(auth.status),
      })
      .then(() => readBridge().focusWindow())
      .then(() =>
        readBridge().refreshAgentStatuses(wslDistros, {
          agentKinds: [props.agentKind],
          envs: [scopeEnvForStatus(auth.status)],
        }),
      )
      .then(() => toast.success(`${agent.label} authenticated.`))
      .catch((error) =>
        toast.danger(
          error instanceof Error ? error.message : `Unable to authenticate ${agent.label}.`,
        ),
      )
      .finally(() => {
        setAuthPending(false);
        setAuthPendingMessage(undefined);
        setAuthPendingEnvKey(undefined);
      });
  };
  const logoutAgent = (status: AgentStatus) => {
    if (!acpInstanceId) return;
    setAuthPending(true);
    readBridge()
      .logoutAcpRegistryAgent({
        agentId: acpInstanceId,
        ...agentAuthTarget(status),
      })
      .then(() =>
        readBridge().refreshAgentStatuses(wslDistros, {
          agentKinds: [props.agentKind],
          envs: [scopeEnvForStatus(status)],
        }),
      )
      .then(() => toast.success(`${agent.label} logged out.`))
      .catch((error) =>
        toast.danger(error instanceof Error ? error.message : `Unable to log out ${agent.label}.`),
      )
      .finally(() => setAuthPending(false));
  };
  const hasAuthSettings =
    envVarAuthMethod !== undefined ||
    agentAuth !== undefined ||
    loginCommand !== undefined ||
    missingAuthStatuses.length > 0 ||
    logoutStatuses.length > 0;
  const includeAuthFallbackMetadata = !hasAuthSettings;
  const metadataStatuses = installedStatuses.filter(
    (status) =>
      formatAgentMetadataSummary(status, {
        includeAuthFallback: includeAuthFallbackMetadata,
      }) !== undefined,
  );
  const authMissing = missingAuthStatuses.length > 0;
  const missingAuthLabel = formatStatusList(missingAuthStatuses);
  const showAuthEnvironmentLabels = installedStatuses.length > 1;
  const showEnvVarOnly = envVarAuthMethod !== undefined && !authMissing;
  // Interactive auth (browser/CLI sign-in) is per-env — Windows and each WSL
  // distro hold their own sessions. We split the auth panel into one row per
  // env so each shows its own state independently. Env-var credentials stay
  // shared (single block above the per-env rows).
  const hasInteractiveAuth = installedStatuses.some((status) =>
    status.authMethods?.some((method) => isAgentAuthMethod(method) || method.type === "terminal"),
  );
  // When env-var credentials already satisfy every env, the user is signed in
  // via the shared key — per-env Logout rows are misleading because there is
  // no per-env session to revoke. Show just the env-var block in that case.
  const envVarFullySatisfied =
    envVarAuthMethod !== undefined &&
    installedStatuses.length > 0 &&
    installedStatuses.every((status) => status.authState === "authenticated");
  const usePerEnvAuthRows =
    acpInstanceId !== undefined && hasInteractiveAuth && !envVarFullySatisfied;
  const clearEnvVarCredentials = () => {
    if (!envVarAuthMethod || !acpInstanceId) return;
    const environment = Object.fromEntries(
      envVarAuthMethod.vars.map((variable) => [variable.name, ""]),
    );
    setAuthPending(true);
    readBridge()
      .setAcpRegistryAgentAuth({ agentId: acpInstanceId, environment })
      .then(() => readBridge().refreshAgentStatuses(wslDistros, { agentKinds: [props.agentKind] }))
      .then(() => {
        setAuthValues({});
        toast.success(`${agent.label} credentials removed.`);
      })
      .catch((error) =>
        toast.danger(
          error instanceof Error ? error.message : `Unable to remove ${agent.label} credentials.`,
        ),
      )
      .finally(() => setAuthPending(false));
  };

  const installedVersion = installedRegistryRecord?.version ?? agent.version;
  const updateAvailable =
    acpInstanceId !== undefined &&
    latestRegistryVersion !== undefined &&
    installedVersion !== undefined &&
    latestRegistryVersion !== installedVersion;
  const performUpdate = () => {
    if (!acpInstanceId || !updateAvailable) return;
    setUpdatePending(true);
    readBridge()
      .updateAcpRegistryAgent({ agentId: acpInstanceId })
      .then(() => readBridge().refreshAgentStatuses(wslDistros, { agentKinds: [props.agentKind] }))
      .then(() => toast.success(`${agent.label} updated to v${latestRegistryVersion}.`))
      .catch((error) =>
        toast.danger(error instanceof Error ? error.message : `Unable to update ${agent.label}.`),
      )
      .finally(() => setUpdatePending(false));
  };

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
            {updateAvailable ? (
              <Button size="sm" variant="ghost" isPending={updatePending} onPress={performUpdate}>
                <ArrowUpCircle className="size-4" />
                Update to v{latestRegistryVersion}
              </Button>
            ) : null}
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
                  includeAuthFallback={includeAuthFallbackMetadata}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          {hasAuthSettings && usePerEnvAuthRows ? (
            <div className="space-y-2">
              {envVarAuthMethod && acpInstanceId ? (
                <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-secondary px-3 py-2 text-foreground">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{envVarAuthMethod.name}</p>
                      <p className="text-xs text-muted">
                        Saved credentials are shared across all environments.
                      </p>
                      <div className="mt-3 flex flex-col gap-2">
                        {envVarAuthMethod.vars.map((variable) => {
                          const hasAuthValue = Object.prototype.hasOwnProperty.call(
                            authValues,
                            variable.name,
                          );
                          const allEnvVarSaved =
                            missingAuthStatuses.length === 0 && installedStatuses.length > 0;
                          return (
                            <Input
                              key={variable.name}
                              aria-label={variable.label ?? variable.name}
                              className="w-full"
                              placeholder={variable.label ?? variable.name}
                              type={
                                variable.secret === false || (!hasAuthValue && allEnvVarSaved)
                                  ? "text"
                                  : "password"
                              }
                              value={
                                hasAuthValue
                                  ? (authValues[variable.name] ?? "")
                                  : allEnvVarSaved
                                    ? SAVED_SECRET_MASK
                                    : ""
                              }
                              onFocus={() => {
                                if (allEnvVarSaved && !hasAuthValue) {
                                  setAuthValues((current) => ({
                                    ...current,
                                    [variable.name]: "",
                                  }));
                                }
                              }}
                              onBlur={(event) => {
                                if (!allEnvVarSaved) return;
                                if (
                                  event.relatedTarget instanceof HTMLElement &&
                                  event.relatedTarget.closest("[data-acp-auth-save]")
                                ) {
                                  return;
                                }
                                setAuthValues((current) => {
                                  if (
                                    !Object.prototype.hasOwnProperty.call(current, variable.name)
                                  ) {
                                    return current;
                                  }
                                  const next = { ...current };
                                  delete next[variable.name];
                                  return next;
                                });
                              }}
                              onChange={(event) =>
                                setAuthValues((current) => ({
                                  ...current,
                                  [variable.name]: event.target.value,
                                }))
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-row items-center gap-2">
                    <Button
                      size="sm"
                      variant="tertiary"
                      isIconOnly
                      aria-label="Save"
                      isDisabled={!canSaveEnvAuth}
                      isPending={authPending}
                      data-acp-auth-save=""
                      onPress={saveEnvAuth}
                    >
                      <Save className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
              {installedStatuses.map((status) => {
                const envKey = statusEnvKey(status);
                const method = status.authMethods?.find(isAgentAuthMethod);
                return (
                  <AcpAgentAuthEnvRow
                    key={`${status.kind}-${envKey}-auth-row`}
                    status={status}
                    agentAuthMethod={method}
                    authPending={authPending}
                    pendingMessage={authPendingEnvKey === envKey ? authPendingMessage : undefined}
                    showEnvironmentLabel={showAuthEnvironmentLabels}
                    onLogin={() => method && authenticateAgent({ status, method })}
                    onLogout={() => logoutAgent(status)}
                  />
                );
              })}
            </div>
          ) : hasAuthSettings ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${authMissing ? "text-warning" : ""}`}>
                      {authMissing ? (
                        <AlertTriangle className="mr-1.5 inline size-4 -translate-y-px text-warning" />
                      ) : null}
                      {authMissing ? "Login required" : "Authentication"}
                    </p>
                    <p className="text-xs text-muted">
                      {authMissing
                        ? `${missingAuthLabel ? `${missingAuthLabel} needs authentication. ` : ""}${
                            envVarAuthMethod
                              ? agentAuth
                                ? `Complete ${agentAuth.method.name} sign-in or save ${envVarAuthMethod.name} credentials, then detected agents will refresh.`
                                : `Save ${envVarAuthMethod.name} credentials, then detected agents will refresh.`
                              : agentAuth
                                ? `Complete ${agentAuth.method.name} sign-in, then detected agents will refresh.`
                                : loginCommand
                                  ? `Run ${loginCommand} to sign in.`
                                  : "Sign in with the agent CLI, then refresh detected agents."
                          }`
                        : envVarAuthMethod
                          ? `Saved ${envVarAuthMethod.name} credentials are configured. Enter a new value to replace them.`
                          : agentAuth
                            ? `Sign in again with ${agentAuth.method.name}.`
                            : loginCommand
                              ? `Run ${loginCommand} again to refresh credentials.`
                              : "Credentials are configured."}
                    </p>
                    {authPendingMessage ? (
                      <p className="mt-1 text-xs text-muted">{authPendingMessage}</p>
                    ) : null}
                  </div>
                </div>
                {showEnvVarOnly && acpInstanceId ? (
                  <div className="flex shrink-0 flex-row items-center gap-2">
                    <Button
                      size="sm"
                      variant="tertiary"
                      isIconOnly
                      aria-label="Save"
                      isDisabled={!canSaveEnvAuth}
                      isPending={authPending}
                      data-acp-auth-save=""
                      onPress={saveEnvAuth}
                    >
                      <Save className="size-4" />
                    </Button>
                    {/* Env-var credentials are shared across envs — a single
                      "Logout" clears them for all environments. */}
                    <Button
                      size="sm"
                      variant="tertiary"
                      isIconOnly
                      aria-label="Logout"
                      isPending={authPending}
                      onPress={clearEnvVarCredentials}
                    >
                      <LogOut className="size-4 text-danger" />
                    </Button>
                  </div>
                ) : agentAuth && acpInstanceId ? (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {(agentAuthEntries.length > 0 ? agentAuthEntries : [agentAuth]).map(
                      (entry, index) => (
                        <Button
                          key={`${entry.status.kind}-${entry.status.envKind ?? "native"}-${entry.status.envDistro ?? index}`}
                          size="sm"
                          variant="tertiary"
                          isPending={authPending}
                          onPress={() => authenticateAgent(entry)}
                        >
                          <LogIn className="size-4" />
                          {authMissing ? "Login" : "Re-login"}
                          {showAuthEnvironmentLabels ? ` ${envLabel(entry.status)}` : ""}
                        </Button>
                      ),
                    )}
                    {envVarAuthMethod ? (
                      <Button
                        size="sm"
                        variant="tertiary"
                        isIconOnly
                        aria-label="Save"
                        isDisabled={!canSaveEnvAuth}
                        isPending={authPending}
                        data-acp-auth-save=""
                        onPress={saveEnvAuth}
                      >
                        <Save className="size-4" />
                      </Button>
                    ) : null}
                    {logoutStatuses.map((status, index) => (
                      <Button
                        key={`${status.kind}-${status.envKind ?? "native"}-${status.envDistro ?? index}-logout`}
                        size="sm"
                        variant="tertiary"
                        isPending={authPending}
                        onPress={() => logoutAgent(status)}
                      >
                        <LogOut className="size-4" />
                        Logout
                        {showAuthEnvironmentLabels ? ` ${envLabel(status)}` : ""}
                      </Button>
                    ))}
                  </div>
                ) : envVarAuthMethod && acpInstanceId ? (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Button
                      size="sm"
                      variant="tertiary"
                      isIconOnly
                      aria-label="Save"
                      isDisabled={!canSaveEnvAuth}
                      isPending={authPending}
                      data-acp-auth-save=""
                      onPress={saveEnvAuth}
                    >
                      <Save className="size-4" />
                    </Button>
                    {logoutStatuses.map((status, index) => (
                      <Button
                        key={`${status.kind}-${status.envKind ?? "native"}-${status.envDistro ?? index}-logout`}
                        size="sm"
                        variant="tertiary"
                        isPending={authPending}
                        onPress={() => logoutAgent(status)}
                      >
                        <LogOut className="size-4" />
                        Logout
                        {showAuthEnvironmentLabels ? ` ${envLabel(status)}` : ""}
                      </Button>
                    ))}
                  </div>
                ) : loginStatus && loginCommand ? (
                  <div className="flex shrink-0 flex-col items-end gap-2">
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
                      {authMissing ? "Login" : "Re-login"}
                    </Button>
                    {logoutStatuses.map((status, index) => (
                      <Button
                        key={`${status.kind}-${status.envKind ?? "native"}-${status.envDistro ?? index}-logout`}
                        size="sm"
                        variant="tertiary"
                        isPending={authPending}
                        onPress={() => logoutAgent(status)}
                      >
                        <LogOut className="size-4" />
                        Logout
                        {showAuthEnvironmentLabels ? ` ${envLabel(status)}` : ""}
                      </Button>
                    ))}
                  </div>
                ) : logoutStatuses.length > 0 && acpInstanceId ? (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {logoutStatuses.map((status, index) => (
                      <Button
                        key={`${status.kind}-${status.envKind ?? "native"}-${status.envDistro ?? index}-logout`}
                        size="sm"
                        variant="tertiary"
                        isPending={authPending}
                        onPress={() => logoutAgent(status)}
                      >
                        <LogOut className="size-4" />
                        Logout
                        {showAuthEnvironmentLabels ? ` ${envLabel(status)}` : ""}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
              {envVarAuthMethod && acpInstanceId ? (
                <div className="flex flex-col gap-2">
                  {envVarAuthMethod.vars.map((variable) => {
                    const hasAuthValue = Object.prototype.hasOwnProperty.call(
                      authValues,
                      variable.name,
                    );
                    return (
                      <Input
                        key={variable.name}
                        aria-label={variable.label ?? variable.name}
                        className="w-full"
                        placeholder={variable.label ?? variable.name}
                        type={
                          variable.secret === false || (!hasAuthValue && !authMissing)
                            ? "text"
                            : "password"
                        }
                        value={
                          hasAuthValue
                            ? (authValues[variable.name] ?? "")
                            : authMissing
                              ? ""
                              : SAVED_SECRET_MASK
                        }
                        onFocus={() => {
                          if (!authMissing && !hasAuthValue) {
                            setAuthValues((current) => ({ ...current, [variable.name]: "" }));
                          }
                        }}
                        onBlur={(event) => {
                          if (authMissing) return;
                          if (
                            event.relatedTarget instanceof HTMLElement &&
                            event.relatedTarget.closest("[data-acp-auth-save]")
                          ) {
                            return;
                          }
                          setAuthValues((current) => {
                            if (!Object.prototype.hasOwnProperty.call(current, variable.name)) {
                              return current;
                            }
                            const next = { ...current };
                            delete next[variable.name];
                            return next;
                          });
                        }}
                        onChange={(event) =>
                          setAuthValues((current) => ({
                            ...current,
                            [variable.name]: event.target.value,
                          }))
                        }
                      />
                    );
                  })}
                </div>
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
                    .refreshAgentStatuses(wslDistros, { agentKinds: [agent.kind] })
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
