import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AcpRegistryListResult } from "@/shared/contracts";
import {
  backfillAcpRegistryAgentIcons,
  installAcpRegistryAgent,
  resolveRegistryAgentFamilyKind,
} from "./acpRegistry";

describe("ACP registry family mapping", () => {
  it("maps known registry agents to provider families for presentation only", () => {
    expect(resolveRegistryAgentFamilyKind("codex-acp")).toBe("codex");
    expect(resolveRegistryAgentFamilyKind("cursor")).toBe("cursor");
    expect(resolveRegistryAgentFamilyKind("gemini")).toBe("gemini");
    expect(resolveRegistryAgentFamilyKind("opencode")).toBe("opencode");
  });

  it("leaves unknown registry agents for the generic ACP adapter", () => {
    expect(resolveRegistryAgentFamilyKind("agoragentic-acp")).toBeUndefined();
  });

  it("installs known ACP wrappers as generic ACP instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lightcode-acp-registry-"));
    const settingsPath = join(dir, "settings.json");
    const registry: AcpRegistryListResult = {
      version: "1.0.0",
      agents: [
        {
          id: "codex-acp",
          name: "Codex ACP",
          version: "1.0.0",
          description: "Codex via ACP",
          distribution: { npx: { package: "codex-acp@1.0.0" } },
        },
      ],
    };
    const fetchMock = vi
      .fn<() => Promise<{ ok: boolean; json: () => Promise<AcpRegistryListResult> }>>()
      .mockResolvedValue({
        ok: true,
        json: async () => registry,
      });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const installed = await installAcpRegistryAgent({
        agentId: "codex-acp",
        baseDir: dir,
        settingsPath,
      });

      expect(installed).toMatchObject([
        {
          id: "codex-acp",
          adapterKind: "acp-generic:codex-acp",
          installKind: "generic",
        },
      ]);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        agentInstances: Record<string, { driver?: string; config?: { binary?: string } }>;
      };
      expect(settings.agentInstances["codex-acp"]).toMatchObject({
        driver: "acp-generic",
        config: { binary: "npx" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("backfills registry icons into existing generic installs", () => {
    const dir = mkdtempSync(join(tmpdir(), "lightcode-acp-registry-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        acpRegistryInstalledAgents: {
          "glm-acp-agent": {
            id: "glm-acp-agent",
            name: "GLM Agent",
            version: "1.1.3",
            installedAt: new Date(0).toISOString(),
            adapterKind: "acp-generic:glm-acp-agent",
            installKind: "generic",
          },
        },
        agentInstances: {
          "glm-acp-agent": {
            id: "glm-acp-agent",
            driver: "acp-generic",
            displayName: "GLM Agent",
            enabled: true,
            config: {
              binary: "npx",
              args: ["-y", "glm-acp-agent@1.1.3"],
              authMode: "none",
            },
          },
        },
      }),
      "utf8",
    );
    const registry: AcpRegistryListResult = {
      version: "1.0.0",
      agents: [
        {
          id: "glm-acp-agent",
          name: "GLM Agent",
          version: "1.1.3",
          description: "GLM",
          icon: "https://cdn.agentclientprotocol.com/registry/v1/latest/glm-acp-agent.svg",
          distribution: { npx: { package: "glm-acp-agent@1.1.3" } },
        },
      ],
    };

    expect(backfillAcpRegistryAgentIcons({ registry, settingsPath })).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      acpRegistryInstalledAgents: Record<string, { icon?: string }>;
      agentInstances: Record<string, { icon?: string }>;
    };

    expect(settings.acpRegistryInstalledAgents["glm-acp-agent"]?.icon).toBe(
      registry.agents[0]!.icon,
    );
    expect(settings.agentInstances["glm-acp-agent"]?.icon).toBe(registry.agents[0]!.icon);
  });
});
