import { describe, expect, it, vi } from "vitest";
import type { McpProbeEnvironment, McpServer, McpToolCallResult } from "@/shared/contracts";
import { McpToolCallService } from "./McpToolCallService";

type HostCall = (
  server: McpServer,
  toolName: string,
  args: unknown,
  environment: McpProbeEnvironment,
  signal: AbortSignal,
) => Promise<McpToolCallResult>;

const server: McpServer = {
  id: "cc",
  name: "control-centre",
  description: "",
  enabled: true,
  timeoutMs: 2_000,
  transport: { type: "stdio", command: "cc-mcp", args: [], env: {} },
};

function ok(content: unknown): McpToolCallResult {
  return {
    status: "ok",
    content,
    latencyMs: 1,
    environment: { runtime: "host", projectScoped: false },
  };
}

describe("McpToolCallService", () => {
  it("calls the resolved tool on the host and returns its result", async () => {
    const callHost = vi.fn<HostCall>(async () => ok({ hello: "world" }));
    const service = new McpToolCallService({ callHost });

    await expect(
      service.call({ server, toolName: "get_campaign_context", args: { id: "g1" } }),
    ).resolves.toMatchObject({ status: "ok", content: { hello: "world" } });

    expect(callHost).toHaveBeenCalledWith(
      expect.objectContaining({ name: "control-centre" }),
      "get_campaign_context",
      { id: "g1" },
      { runtime: "host", projectScoped: false },
      expect.any(AbortSignal),
    );
  });

  it("applies the project's native cwd to a workspace-scoped stdio call", async () => {
    const callHost = vi.fn<HostCall>(async () => ok({}));
    const service = new McpToolCallService({ callHost });

    await service.call({
      server,
      projectLocation: { kind: "posix", path: "/repo" },
      toolName: "get_campaign_context",
      args: {},
    });

    expect(callHost).toHaveBeenCalledWith(
      expect.objectContaining({ transport: expect.objectContaining({ cwd: "/repo" }) }),
      "get_campaign_context",
      {},
      { runtime: "host", projectScoped: true },
      expect.any(AbortSignal),
    );
  });

  it("applies stored authorization to the server before calling", async () => {
    const callHost = vi.fn<HostCall>(async () => ok({}));
    const applyAuthorization = vi.fn<(input: McpServer) => Promise<McpServer>>(async (input) => ({
      ...input,
      transport: { ...input.transport, env: { AUTH: "token" } } as McpServer["transport"],
    }));
    const service = new McpToolCallService({ callHost, applyAuthorization });

    await service.call({ server, toolName: "get_campaign_context", args: {} });

    expect(applyAuthorization).toHaveBeenCalledWith(server);
    expect(callHost).toHaveBeenCalledWith(
      expect.objectContaining({ transport: expect.objectContaining({ env: { AUTH: "token" } }) }),
      "get_campaign_context",
      {},
      expect.anything(),
      expect.any(AbortSignal),
    );
  });

  it("maps an unexpected host-call rejection to the unavailable state", async () => {
    const callHost = vi.fn<HostCall>(async () => {
      throw new Error("boom");
    });
    const service = new McpToolCallService({ callHost });

    await expect(
      service.call({ server, toolName: "get_campaign_context", args: {} }),
    ).resolves.toMatchObject({ status: "unavailable", error: { code: "connection-failed" } });
  });

  it("disposes by aborting in-flight calls", async () => {
    let capturedSignal: AbortSignal | undefined;
    const callHost = vi.fn<HostCall>(
      (_server, _toolName, _args, _environment, signal) =>
        new Promise((_resolve, reject) => {
          capturedSignal = signal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const service = new McpToolCallService({ callHost });

    const pending = service.call({ server, toolName: "get_campaign_context", args: {} });
    service.dispose();

    await expect(pending).resolves.toMatchObject({ status: "unavailable" });
    expect(capturedSignal?.aborted).toBe(true);
  });
});
