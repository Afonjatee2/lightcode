import { beforeEach, describe, expect, it } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "./agentStatusesStore";

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

describe("agentStatusesStore", () => {
  beforeEach(() => {
    useAgentStatusesStore.setState({
      agentStatuses: [],
      wslAgentStatuses: [],
      windowsLoaded: false,
      wslLoaded: false,
      inFirstLaunchDiscovery: false,
      discoveredAgents: [],
    });
  });

  it("updates cached statuses when fresh capabilities add slash commands", () => {
    const cached = makeStatus();
    const fresh = makeStatus({
      capabilities: {
        ...cached.capabilities,
        slashCommands: [
          {
            id: "status",
            label: "status - Display session configuration and token usage",
            description: "Display session configuration and token usage",
          },
        ],
      },
    });

    useAgentStatusesStore.getState().hydrateFromCache({ windows: [cached], wsl: [] });
    useAgentStatusesStore.getState().setAgentStatuses([fresh]);

    expect(useAgentStatusesStore.getState().agentStatuses[0]?.capabilities.slashCommands).toEqual(
      fresh.capabilities.slashCommands,
    );
  });
});
