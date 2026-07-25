import { describe, expect, it } from "vitest";
import type { SpawnableAgent } from "@/supervisor/crossagentMcp/types";
import { CampaignAgentRegistry } from "./campaignAgentRegistry";

const sampleClaude: SpawnableAgent = {
  provider: { value: "claude", label: "Claude Code" },
  models: [
    {
      value: "claude-sonnet-3-7",
      label: "Claude 3.7 Sonnet",
      tier: "max-capability",
      reasoning: { values: [] },
    },
    {
      value: "claude-haiku-3-5",
      label: "Claude 3.5 Haiku",
      tier: "fast-cheap",
      reasoning: { values: [] },
    },
  ],
  reasoningOptions: [],
  defaultModel: "claude-sonnet-3-7",
  execution: "structured",
  permissions: {
    options: [{ value: "full-access", label: "Full access" }],
    default: "full-access",
  },
};

describe("CampaignAgentRegistry cold cache resilience", () => {
  it("resolves agents even when getCapabilities returns undefined", async () => {
    const registry = new CampaignAgentRegistry({
      getSpawnableAgents: async () => [sampleClaude],
      getCapabilities: () => undefined,
    });

    const entries = await registry.resolveAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agentKind).toBe("claude");
    expect(entries[0]?.roles).toContain("strategic_reviewer");
    expect(entries[0]?.roles).toContain("daily_operator");
  });

  it("awaits pending detection when initial spawnable list is empty", async () => {
    let pendingAwaited = false;
    let callCount = 0;
    const registry = new CampaignAgentRegistry({
      getSpawnableAgents: async () => {
        callCount++;
        return callCount === 1 ? [] : [sampleClaude];
      },
      getCapabilities: () => undefined,
      awaitPendingDetection: async () => {
        pendingAwaited = true;
      },
    });

    const entries = await registry.resolveAll();
    expect(pendingAwaited).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agentKind).toBe("claude");
  });
});
