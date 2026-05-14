import { create } from "zustand";
import {
  areAgentSlashCommandsEqual,
  areAgentProviderMetadataEqual,
  type AgentStatus,
  type ProjectLocation,
} from "@/shared/contracts";

interface AgentStatusesStore {
  agentStatuses: AgentStatus[];
  wslAgentStatuses: AgentStatus[];
  /**
   * True once a windows-agent-statuses event (or cache) has been applied.
   * Used by UI to distinguish "detecting…" from "detected nothing".
   */
  windowsLoaded: boolean;
  /** True once a wsl-agent-statuses event (or cache) has been applied. */
  wslLoaded: boolean;
  /**
   * On first launch (no cache) we render a discovery screen that reveals
   * agent tiles as the supervisor streams `agent-detected` events. Once the
   * terminal `windows-agent-statuses` event arrives the discovery screen
   * fades out into the regular ThreadDraft. Stays false on subsequent
   * launches where the cache is loaded eagerly.
   */
  inFirstLaunchDiscovery: boolean;
  /** Statuses streamed from `agent-detected` events during first-launch scan. */
  discoveredAgents: AgentStatus[];
  setAgentStatuses: (statuses: AgentStatus[]) => void;
  setWslAgentStatuses: (statuses: AgentStatus[]) => void;
  /**
   * Hydrate both scopes at once from an RPC cache read.  Called before the
   * main UI mounts so ThreadDraft renders with the cached agents instead of
   * the empty initial state.
   */
  hydrateFromCache: (cached: { windows: AgentStatus[]; wsl: AgentStatus[] }) => void;
  beginFirstLaunchDiscovery: () => void;
  resetDiscoveredAgents: () => void;
  pushDiscoveredAgent: (status: AgentStatus) => void;
  /**
   * Upserts a single status into the store, matched by (kind, envKind,
   * envDistro). Used by scoped refreshes after install/login so we don't
   * overwrite the rest of the list. WSL statuses land in `wslAgentStatuses`;
   * everything else lands in `agentStatuses`.
   */
  mergeAgentStatus: (status: AgentStatus) => void;
}

function capabilitiesEqual(
  a: AgentStatus["capabilities"],
  b: AgentStatus["capabilities"],
): boolean {
  if (a.models.length !== b.models.length) return false;
  if (a.efforts.length !== b.efforts.length) return false;
  for (let i = 0; i < a.models.length; i++) {
    if (a.models[i]!.id !== b.models[i]!.id) return false;
  }
  for (let i = 0; i < a.efforts.length; i++) {
    if (a.efforts[i] !== b.efforts[i]) return false;
  }
  if (!areAgentSlashCommandsEqual(a.slashCommands, b.slashCommands)) return false;
  return true;
}

function statusesEqual(a: AgentStatus[], b: AgentStatus[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.kind === b[i]!.kind &&
      x.installed === b[i]!.installed &&
      x.icon === b[i]!.icon &&
      x.version === b[i]!.version &&
      x.authState === b[i]!.authState &&
      x.loginCommand === b[i]!.loginCommand &&
      JSON.stringify(x.authMethods ?? []) === JSON.stringify(b[i]!.authMethods ?? []) &&
      areAgentProviderMetadataEqual(x.providerMetadata, b[i]!.providerMetadata) &&
      capabilitiesEqual(x.capabilities, b[i]!.capabilities),
  );
}

export const useAgentStatusesStore = create<AgentStatusesStore>()((set) => ({
  agentStatuses: [],
  wslAgentStatuses: [],
  windowsLoaded: false,
  wslLoaded: false,
  inFirstLaunchDiscovery: false,
  discoveredAgents: [],
  setAgentStatuses: (incoming) =>
    set((prev) => {
      const equal = statusesEqual(prev.agentStatuses, incoming);
      if (equal && prev.windowsLoaded) {
        return prev.inFirstLaunchDiscovery ? { inFirstLaunchDiscovery: false } : {};
      }
      return {
        ...(equal ? {} : { agentStatuses: incoming }),
        windowsLoaded: true,
        inFirstLaunchDiscovery: false,
      };
    }),
  setWslAgentStatuses: (incoming) =>
    set((prev) => {
      const equal = statusesEqual(prev.wslAgentStatuses, incoming);
      if (equal && prev.wslLoaded) {
        return prev;
      }
      return {
        ...(equal ? {} : { wslAgentStatuses: incoming }),
        wslLoaded: true,
      };
    }),
  hydrateFromCache: ({ windows, wsl }) =>
    set(() => ({
      agentStatuses: windows,
      wslAgentStatuses: wsl,
      windowsLoaded: true,
      wslLoaded: true,
      inFirstLaunchDiscovery: false,
    })),
  beginFirstLaunchDiscovery: () =>
    set((prev) => {
      if (prev.windowsLoaded) {
        return prev;
      }
      return { inFirstLaunchDiscovery: true, discoveredAgents: [] };
    }),
  resetDiscoveredAgents: () =>
    set((prev) =>
      prev.discoveredAgents.length === 0 && !prev.inFirstLaunchDiscovery
        ? prev
        : { discoveredAgents: [], inFirstLaunchDiscovery: false },
    ),
  pushDiscoveredAgent: (status) =>
    set((prev) => {
      if (status.envKind === "wsl") {
        return prev;
      }
      if (prev.discoveredAgents.some((existing) => existing.kind === status.kind)) {
        return prev;
      }
      return { discoveredAgents: [...prev.discoveredAgents, status] };
    }),
  mergeAgentStatus: (status) =>
    set((prev) => {
      const matches = (entry: AgentStatus) =>
        entry.kind === status.kind &&
        entry.envKind === status.envKind &&
        entry.envDistro === status.envDistro;
      if (status.envKind === "wsl") {
        const idx = prev.wslAgentStatuses.findIndex(matches);
        const next =
          idx === -1
            ? [...prev.wslAgentStatuses, status]
            : prev.wslAgentStatuses.map((entry, i) => (i === idx ? status : entry));
        return { wslAgentStatuses: next, wslLoaded: true };
      }
      const idx = prev.agentStatuses.findIndex(matches);
      const next =
        idx === -1
          ? [...prev.agentStatuses, status]
          : prev.agentStatuses.map((entry, i) => (i === idx ? status : entry));
      return { agentStatuses: next, windowsLoaded: true };
    }),
}));

/**
 * Returns true when we haven't received agent statuses yet for the given
 * project's environment.  Callers use this to distinguish "detecting…" from
 * "detected, but nothing installed" — the former shows a spinner, the latter
 * shows the install-agents prompt.
 */
export function isDetectingAgentsForLocation(
  state: { windowsLoaded: boolean; wslLoaded: boolean },
  location: ProjectLocation,
): boolean {
  return location.kind === "wsl" ? !state.wslLoaded : !state.windowsLoaded;
}
