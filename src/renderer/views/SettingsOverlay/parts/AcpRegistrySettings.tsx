import { useEffect, useState } from "react";
import { Button, Input, ToggleButton, ToggleButtonGroup, Tooltip } from "@heroui/react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  GitFork,
  HardDrive,
  Link,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { AcpRegistryAgent, InstalledAcpRegistryAgent } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { buildWslProjectDistrosKey } from "@/renderer/state/projectKeys";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";

type RegistryFilter = "all" | "installed" | "notInstalled";

const FIRST_CLASS_REGISTRY_AGENT_KIND: Record<string, string> = {
  "claude-acp": "claude",
  "codex-acp": "codex",
  cursor: "cursor",
  gemini: "gemini",
  "github-copilot": "copilot",
  "github-copilot-cli": "copilot",
  opencode: "opencode",
};

function registrySearchText(agent: AcpRegistryAgent): string {
  return [
    agent.id,
    agent.name,
    agent.description,
    agent.repository,
    agent.website,
    ...(agent.authors ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function distributionLabel(agent: AcpRegistryAgent): string {
  if (agent.distribution.npx) return `npx ${agent.distribution.npx.package}`;
  if (agent.distribution.uvx) return `uvx ${agent.distribution.uvx.package}`;
  if (agent.distribution.binary) return "Binary";
  return "Custom";
}

function AgentIcon(props: { agent: AcpRegistryAgent; installedKind?: string }) {
  if (props.installedKind) {
    return <ProviderIcon kind={props.installedKind} className="size-5" />;
  }
  if (props.agent.icon) {
    return (
      <img alt="" className="size-5 shrink-0 rounded-sm" src={props.agent.icon} loading="lazy" />
    );
  }
  return (
    <div className="flex size-5 shrink-0 items-center justify-center rounded border border-border text-[10px] font-semibold text-muted">
      {props.agent.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function AcpRegistrySettings() {
  const [agents, setAgents] = useState<AcpRegistryAgent[]>([]);
  const [version, setVersion] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RegistryFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [pendingAgentId, setPendingAgentId] = useState<string | undefined>();
  const [mutatedInstalled, setMutatedInstalled] = useState<InstalledAcpRegistryAgent[]>();

  const settingsInstalled = useSharedSettings((s) => s.acpRegistryInstalledAgents);
  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((s) => s.wslAgentStatuses);
  const wslProjectDistrosKey = useAppStore((state) => buildWslProjectDistrosKey(state.projects));
  const wslDistros = wslProjectDistrosKey ? wslProjectDistrosKey.split("\0") : [];

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    readBridge()
      .listAcpRegistry()
      .then((result) => {
        if (cancelled) return;
        setAgents(result.agents);
        setVersion(result.version);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const installedRecords = mutatedInstalled ?? Object.values(settingsInstalled);
  const installedById = new Map(installedRecords.map((record) => [record.id, record]));
  const detectedInstalledKinds = new Set(
    [...agentStatuses, ...wslAgentStatuses]
      .filter((status) => status.installed)
      .map((status) => status.kind),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAgents = agents.filter((agent) => {
    if (normalizedQuery && !registrySearchText(agent).includes(normalizedQuery)) return false;
    const registryInstalled = installedById.has(agent.id);
    const firstClassKind = FIRST_CLASS_REGISTRY_AGENT_KIND[agent.id];
    const localInstalled = firstClassKind ? detectedInstalledKinds.has(firstClassKind) : false;
    if (filter === "installed") return registryInstalled || localInstalled;
    if (filter === "notInstalled") return !registryInstalled && !localInstalled;
    return true;
  });

  const refreshStatuses = () => {
    useAgentStatusesStore.getState().resetDiscoveredAgents();
    void readBridge()
      .refreshAgentStatuses(wslDistros)
      .catch(() => undefined);
  };

  const installAgent = (agentId: string) => {
    setPendingAgentId(agentId);
    setError(undefined);
    readBridge()
      .installAcpRegistryAgent({ agentId })
      .then((result) => {
        setMutatedInstalled(result.installed);
        refreshStatuses();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setPendingAgentId(undefined));
  };

  const removeAgent = (agentId: string) => {
    setPendingAgentId(agentId);
    setError(undefined);
    readBridge()
      .removeAcpRegistryAgent({ agentId })
      .then((result) => {
        setMutatedInstalled(result.installed);
        refreshStatuses();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setPendingAgentId(undefined));
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">ACP Registry</h1>
            {version ? <p className="mt-0.5 text-xs text-muted">Registry v{version}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setIsLoading(true);
                    setError(undefined);
                    readBridge()
                      .listAcpRegistry()
                      .then((result) => {
                        setAgents(result.agents);
                        setVersion(result.version);
                      })
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : String(err));
                      })
                      .finally(() => setIsLoading(false));
                  }}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Refresh registry</Tooltip.Content>
            </Tooltip>
            <Button
              size="sm"
              variant="secondary"
              onPress={() =>
                void readBridge().openExternal(
                  "https://agentclientprotocol.com/get-started/registry",
                )
              }
            >
              Learn More
              <ExternalLink className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              aria-label="Search agents"
              className="w-full pl-9"
              placeholder="Search agents..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <ToggleButtonGroup
            aria-label="Registry filter"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[filter]}
            onSelectionChange={(keys) => {
              const next = [...keys][0] as RegistryFilter | undefined;
              if (next) setFilter(next);
            }}
          >
            <ToggleButton id="all">All</ToggleButton>
            <ToggleButton id="installed">Installed</ToggleButton>
            <ToggleButton id="notInstalled">Not Installed</ToggleButton>
          </ToggleButtonGroup>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="py-10 text-sm text-muted">Loading registry...</div>
        ) : (
          <div className="space-y-3">
            {filteredAgents.map((agent) => {
              const installedRecord = installedById.get(agent.id);
              const firstClassKind = FIRST_CLASS_REGISTRY_AGENT_KIND[agent.id];
              const localInstalled = firstClassKind
                ? detectedInstalledKinds.has(firstClassKind)
                : false;
              const rowInstalledKind =
                installedRecord?.installKind === "first-class"
                  ? installedRecord.adapterKind
                  : firstClassKind;
              const isPending = pendingAgentId === agent.id;
              const canRemove = installedRecord !== undefined;
              const isAvailable = installedRecord !== undefined || localInstalled;

              return (
                <div
                  key={agent.id}
                  className="rounded-lg border border-border bg-surface-secondary px-4 py-4"
                >
                  <div className="flex items-start gap-4">
                    <AgentIcon
                      agent={agent}
                      {...(rowInstalledKind ? { installedKind: rowInstalledKind } : {})}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h2 className="truncate text-base font-semibold text-foreground">
                          {agent.name}
                        </h2>
                        <span className="text-sm font-medium tabular-nums text-muted">
                          v{agent.version}
                        </span>
                        {installedRecord?.installKind === "first-class" ? (
                          <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted">
                            First class
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-foreground/85">
                        {agent.description}
                      </p>
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
                        <span className="font-medium">ID: {agent.id}</span>
                        <span>{distributionLabel(agent)}</span>
                        {agent.repository ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-muted transition-colors hover:text-foreground"
                            onClick={() => void readBridge().openExternal(agent.repository!)}
                          >
                            <GitFork className="size-3.5" />
                            Repository
                          </button>
                        ) : null}
                        {agent.website ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-muted transition-colors hover:text-foreground"
                            onClick={() => void readBridge().openExternal(agent.website!)}
                          >
                            <Link className="size-3.5" />
                            Website
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {canRemove ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          isPending={isPending}
                          onPress={() => removeAgent(agent.id)}
                        >
                          <Trash2 className="size-4" />
                          Remove
                        </Button>
                      ) : localInstalled ? (
                        <Button size="sm" variant="secondary" isDisabled>
                          <HardDrive className="size-4" />
                          Local
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          isPending={isPending}
                          onPress={() => installAgent(agent.id)}
                        >
                          <Download className="size-4" />
                          Install
                        </Button>
                      )}
                      {isAvailable && !canRemove ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <CheckCircle2 className="size-3.5" />
                          Detected
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredAgents.length === 0 ? (
              <div className="py-10 text-sm text-muted">No matching agents.</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
