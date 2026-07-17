import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentKind, ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import type { AgentAdapter } from "@/supervisor/agents/base";
import { createAgentRegistry } from "@/supervisor/agents/registry";
import {
  acquireOpenCodeServer,
  resolveOpenCodeSessionDirectory,
  shutdownSpawnedOpenCodeServers,
} from "@/supervisor/agents/opencode/sdkClient";
import { OrchestratorThreadManager } from "@/supervisor/crossagentMcp/OrchestratorThreadManager";
import { CrossagentMcpIngress } from "@/supervisor/crossagentMcp/CrossagentMcpIngress";
import { SubagentRunManager } from "@/supervisor/crossagentMcp/SubagentRunManager";
import type { SpawnableAgent } from "@/supervisor/crossagentMcp/types";
import type { CrossagentMcpHttpConfig } from "@/supervisor/agents/crossagentMcp";

// Live integration for OpenCode HOSTING the Crossagents MCP.
// Stands up the real ingress + run manager, then acquires a DEDICATED per-thread
// `opencode serve` with the thread's Crossagents config and asserts, via the
// OpenCode client's `mcp.status`, that the `crossagents` server was registered
// (mcp.add) and successfully connected (mcp.connect handshook against the real
// ingress with the per-thread bearer token — a 401 would surface as "failed").
// Skips when OpenCode is not installed on the host.

const PARENT_THREAD_ID = "oc-int-parent-thread";

describe("opencode hosts Crossagents MCP (live)", () => {
  let projectDir: string;
  let ingress: CrossagentMcpIngress;
  let runManager: SubagentRunManager;
  let mcp: CrossagentMcpHttpConfig;
  let opencode: AgentAdapter | undefined;

  const projectLocation = (): ProjectLocation =>
    process.platform === "win32"
      ? { kind: "windows", path: projectDir }
      : { kind: "posix", path: projectDir };

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "poracode-oc-subagent-int-"));
    writeFileSync(join(projectDir, "README.md"), "# opencode subagent host fixture\n");

    const adapters = new Map<AgentKind, AgentAdapter>(
      createAgentRegistry().map((a) => [a.kind, a]),
    );
    opencode = adapters.get("opencode" as AgentKind);

    const parentEvents: RuntimeEvent[] = [];
    runManager = new SubagentRunManager({
      adapters,
      host: {
        getParentContext: (threadId) =>
          threadId === PARENT_THREAD_ID
            ? { projectLocation: projectLocation(), config: { model: "opencode/big-pickle" } }
            : undefined,
        appendRuntimeEvent: (_parentThreadId, event) => {
          parentEvents.push(event);
        },
      },
    });

    const spawnable: SpawnableAgent[] = opencode
      ? [
          {
            provider: { value: opencode.kind, label: opencode.label },
            models: opencode.capabilities.models.map((m) => ({
              value: m.id,
              label: m.label,
              reasoning: { values: [] },
            })),
            reasoningOptions: [],
            defaultModel: opencode.capabilities.models[0]?.id ?? "opencode/big-pickle",
            permissions: {
              options: [{ value: "full-access", label: "Full access" }],
              default: "full-access",
            },
            execution: "structured",
          },
        ]
      : [];

    ingress = new CrossagentMcpIngress({
      runManager,
      orchestrator: new OrchestratorThreadManager({
        adapters: new Map(),
        emit: () => {},
        host: {
          getParentContext: () => undefined,
          getThreadState: () => undefined,
          readThreadHistory: async () => undefined,
          sendThreadInput: async () => {},
          interruptThread: async () => {},
          closeThread: async () => {},
        },
        createWorktree: async () => ({ path: "/unused" }),
        removeWorktree: async () => {},
      }),
      getSpawnableAgents: async () => spawnable,
      getRoutingGuide: () => "Prefer opencode/big-pickle for everything in this test.",
    });
    await ingress.start();
    const registered = ingress.registerThread(PARENT_THREAD_ID);
    if (!registered) throw new Error("ingress did not mint a thread config");
    mcp = registered;
  });

  afterAll(() => {
    shutdownSpawnedOpenCodeServers();
    runManager.cancelAllForThread(PARENT_THREAD_ID);
    ingress.dispose();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("registers + connects the Crossagents MCP on a dedicated per-thread server", async () => {
    if (!opencode) {
      console.log("[oc-subagent-int] SKIPPED: opencode adapter not registered");
      return;
    }
    const status = await opencode.detectInstall().catch(() => undefined);
    if (!status?.installed) {
      console.log(`[oc-subagent-int] SKIPPED: opencode installed=${status?.installed}`);
      return;
    }

    const location = projectLocation();
    const acquired = await acquireOpenCodeServer({
      projectLocation: location,
      mcpServers: [
        {
          id: "crossagents",
          name: "crossagents",
          timeoutMs: 300_000,
          transport: { type: "http", url: mcp.url, headers: mcp.headers },
        },
      ],
      dedicatedKey: PARENT_THREAD_ID,
    });

    try {
      const directory = resolveOpenCodeSessionDirectory(location);
      const result = await acquired.client.mcp.status({ directory });
      const servers = (result.data ?? {}) as Record<string, { status: string; error?: string }>;
      const crossagents = servers.crossagents;
      expect(crossagents).toBeDefined();
      // Connected proves the full path: dedicated server spawned, mcp.add
      // registered the entry, mcp.connect completed the MCP initialize
      // handshake against the live ingress with the per-thread bearer token.
      expect(crossagents?.status).toBe("connected");
    } finally {
      await acquired.dispose();
    }
  }, 120_000);
});
