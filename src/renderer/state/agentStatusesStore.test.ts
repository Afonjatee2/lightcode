import { beforeEach, describe, expect, it } from "vitest";
import type { AgentStatus, ProjectLocation } from "@/shared/contracts";
import { isDetectingAgentsForLocation, useAgentStatusesStore } from "./agentStatusesStore";

function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind: "codex",
    label: "Codex",
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [{ id: "gpt-5.5", label: "5.5" }],
      efforts: ["low", "medium"],
      modelEfforts: {},
      modes: ["agent", "plan"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      presentationModes: ["terminal", "gui"],
      settingDefs: [],
    },
    ...overrides,
  };
}

function reset() {
  useAgentStatusesStore.setState({
    agentStatuses: [],
    wslAgentStatuses: [],
    windowsLoaded: false,
    wslLoaded: false,
    inFirstLaunchDiscovery: false,
    discoveredAgents: [],
  });
}

beforeEach(reset);

describe("setAgentStatuses", () => {
  it("preserves the existing array reference when statuses are identity-equal", () => {
    const initial = [makeStatus({ kind: "claude", label: "Claude" })];
    useAgentStatusesStore.setState({ agentStatuses: initial, windowsLoaded: true });
    useAgentStatusesStore
      .getState()
      .setAgentStatuses([makeStatus({ kind: "claude", label: "Claude" })]);
    expect(useAgentStatusesStore.getState().agentStatuses).toBe(initial);
  });

  it("replaces the array when capabilities change (e.g. new slash commands)", () => {
    const cached = makeStatus();
    const fresh = makeStatus({
      capabilities: {
        ...cached.capabilities,
        slashCommands: [{ id: "status", label: "status", description: "Show config" }],
      },
    });
    useAgentStatusesStore.getState().hydrateFromCache({ windows: [cached], wsl: [] });
    useAgentStatusesStore.getState().setAgentStatuses([fresh]);
    expect(useAgentStatusesStore.getState().agentStatuses[0]?.capabilities.slashCommands).toEqual(
      fresh.capabilities.slashCommands,
    );
  });

  it("flips windowsLoaded to true on first apply, ending first-launch discovery", () => {
    useAgentStatusesStore.setState({ inFirstLaunchDiscovery: true });
    useAgentStatusesStore.getState().setAgentStatuses([]);
    const state = useAgentStatusesStore.getState();
    expect(state.windowsLoaded).toBe(true);
    expect(state.inFirstLaunchDiscovery).toBe(false);
  });
});

describe("setWslAgentStatuses", () => {
  it("routes statuses into wslAgentStatuses (not agentStatuses)", () => {
    useAgentStatusesStore
      .getState()
      .setWslAgentStatuses([makeStatus({ envKind: "wsl", envDistro: "Ubuntu" })]);
    const state = useAgentStatusesStore.getState();
    expect(state.wslAgentStatuses).toHaveLength(1);
    expect(state.agentStatuses).toHaveLength(0);
    expect(state.wslLoaded).toBe(true);
  });

  it("preserves reference when re-applying identical statuses", () => {
    const initial = [makeStatus({ envKind: "wsl", envDistro: "Ubuntu" })];
    useAgentStatusesStore.setState({ wslAgentStatuses: initial, wslLoaded: true });
    useAgentStatusesStore
      .getState()
      .setWslAgentStatuses([makeStatus({ envKind: "wsl", envDistro: "Ubuntu" })]);
    expect(useAgentStatusesStore.getState().wslAgentStatuses).toBe(initial);
  });
});

describe("hydrateFromCache", () => {
  it("populates both lists, marks both scopes loaded, and ends discovery", () => {
    useAgentStatusesStore.setState({ inFirstLaunchDiscovery: true });
    useAgentStatusesStore.getState().hydrateFromCache({
      windows: [makeStatus({ kind: "claude" })],
      wsl: [makeStatus({ kind: "gemini", envKind: "wsl", envDistro: "Ubuntu" })],
    });
    const state = useAgentStatusesStore.getState();
    expect(state.agentStatuses).toHaveLength(1);
    expect(state.wslAgentStatuses).toHaveLength(1);
    expect(state.windowsLoaded).toBe(true);
    expect(state.wslLoaded).toBe(true);
    expect(state.inFirstLaunchDiscovery).toBe(false);
  });
});

describe("beginFirstLaunchDiscovery", () => {
  it("turns on discovery and clears discovered list when not yet loaded", () => {
    useAgentStatusesStore.setState({
      discoveredAgents: [makeStatus({ kind: "stale" as never })],
    });
    useAgentStatusesStore.getState().beginFirstLaunchDiscovery();
    const state = useAgentStatusesStore.getState();
    expect(state.inFirstLaunchDiscovery).toBe(true);
    expect(state.discoveredAgents).toEqual([]);
  });

  it("is a no-op once windowsLoaded=true", () => {
    useAgentStatusesStore.setState({ windowsLoaded: true });
    useAgentStatusesStore.getState().beginFirstLaunchDiscovery();
    expect(useAgentStatusesStore.getState().inFirstLaunchDiscovery).toBe(false);
  });
});

describe("pushDiscoveredAgent", () => {
  it("appends a windows agent and dedupes by kind", () => {
    useAgentStatusesStore.getState().pushDiscoveredAgent(makeStatus({ kind: "claude" }));
    useAgentStatusesStore.getState().pushDiscoveredAgent(makeStatus({ kind: "claude" }));
    expect(useAgentStatusesStore.getState().discoveredAgents).toHaveLength(1);
  });

  it("ignores WSL agents (discovery screen is for the host scope only)", () => {
    useAgentStatusesStore
      .getState()
      .pushDiscoveredAgent(makeStatus({ kind: "gemini", envKind: "wsl", envDistro: "Ubuntu" }));
    expect(useAgentStatusesStore.getState().discoveredAgents).toEqual([]);
  });
});

describe("resetDiscoveredAgents", () => {
  it("clears the discovered list and ends first-launch discovery", () => {
    useAgentStatusesStore.setState({
      discoveredAgents: [makeStatus({ kind: "claude" })],
      inFirstLaunchDiscovery: true,
    });
    useAgentStatusesStore.getState().resetDiscoveredAgents();
    const state = useAgentStatusesStore.getState();
    expect(state.discoveredAgents).toEqual([]);
    expect(state.inFirstLaunchDiscovery).toBe(false);
  });

  it("is a no-op when there is nothing to clear", () => {
    const before = useAgentStatusesStore.getState();
    useAgentStatusesStore.getState().resetDiscoveredAgents();
    expect(useAgentStatusesStore.getState()).toBe(before);
  });
});

describe("mergeAgentStatus", () => {
  it("appends a new posix entry", () => {
    useAgentStatusesStore
      .getState()
      .mergeAgentStatus(makeStatus({ kind: "claude", envKind: "posix" }));
    expect(useAgentStatusesStore.getState().agentStatuses).toHaveLength(1);
    expect(useAgentStatusesStore.getState().windowsLoaded).toBe(true);
  });

  it("updates the matching posix entry in place by (kind, envKind, envDistro)", () => {
    const initial = makeStatus({ kind: "claude", authState: "missing" });
    useAgentStatusesStore.setState({ agentStatuses: [initial], windowsLoaded: true });
    const updated = makeStatus({ kind: "claude", authState: "authenticated" });
    useAgentStatusesStore.getState().mergeAgentStatus(updated);
    const state = useAgentStatusesStore.getState();
    expect(state.agentStatuses).toHaveLength(1);
    expect(state.agentStatuses[0]?.authState).toBe("authenticated");
  });

  it("routes WSL statuses into wslAgentStatuses and keeps posix list untouched", () => {
    const wsl = makeStatus({ kind: "gemini", envKind: "wsl", envDistro: "Ubuntu" });
    useAgentStatusesStore.getState().mergeAgentStatus(wsl);
    const state = useAgentStatusesStore.getState();
    expect(state.wslAgentStatuses).toHaveLength(1);
    expect(state.agentStatuses).toHaveLength(0);
    expect(state.wslLoaded).toBe(true);
  });

  it("treats different envDistro values as distinct entries", () => {
    useAgentStatusesStore
      .getState()
      .mergeAgentStatus(makeStatus({ kind: "gemini", envKind: "wsl", envDistro: "Ubuntu" }));
    useAgentStatusesStore
      .getState()
      .mergeAgentStatus(makeStatus({ kind: "gemini", envKind: "wsl", envDistro: "Debian" }));
    expect(useAgentStatusesStore.getState().wslAgentStatuses).toHaveLength(2);
  });
});

describe("isDetectingAgentsForLocation", () => {
  it("returns true for a windows location when windowsLoaded is false", () => {
    const loc: ProjectLocation = { kind: "windows", path: "C:\\tmp" };
    expect(isDetectingAgentsForLocation({ windowsLoaded: false, wslLoaded: true }, loc)).toBe(true);
  });

  it("returns false for a windows location once windowsLoaded flips true", () => {
    const loc: ProjectLocation = { kind: "windows", path: "C:\\tmp" };
    expect(isDetectingAgentsForLocation({ windowsLoaded: true, wslLoaded: false }, loc)).toBe(
      false,
    );
  });

  it("uses wslLoaded for a WSL location", () => {
    const loc: ProjectLocation = {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/home/u/p",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\home\\u\\p",
    };
    expect(isDetectingAgentsForLocation({ windowsLoaded: true, wslLoaded: false }, loc)).toBe(true);
    expect(isDetectingAgentsForLocation({ windowsLoaded: false, wslLoaded: true }, loc)).toBe(
      false,
    );
  });
});
