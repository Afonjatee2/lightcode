import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mergeMcpServers, diagnoseControlCentreMcpSetup, type McpServer } from "@/shared/contracts";
import { CONTROL_CENTRE_MCP_SERVER_NAME } from "@/shared/contracts/campaign/campaignMcpLaunch";
import { terminateProcessTree } from "@/shared/processTree";

export { CONTROL_CENTRE_MCP_SERVER_NAME };

export type ControlCentreToolOutcome =
  | { status: "ok"; content: unknown }
  | { status: "not-configured"; message: string }
  | { status: "auth-required"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "tool-error"; message: string };

export interface ControlCentreGateway {
  callTool(
    projectId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ControlCentreToolOutcome>;
}

export interface McpControlCentreGatewayDeps {
  /** The project's own MCP servers (Project.mcpServers). */
  getProjectMcpServers: (projectId: string) => readonly McpServer[];
  /** The user's global MCP servers (shared settings). */
  getSharedMcpServers: () => readonly McpServer[];
  /** Optional OAuth authorization applied before constructing the MCP transport. */
  applyAuthorization?: (server: McpServer) => Promise<McpServer>;
}

type GatewayTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

interface AuthObservation {
  status?: number;
}

function observedFetch(observation: AuthObservation): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401 || response.status === 403) {
      observation.status = response.status;
    }
    return response;
  };
}

function createTransport(server: McpServer, observation: AuthObservation): GatewayTransport {
  const transport = server.transport;
  if (transport.type === "stdio") {
    return new StdioClientTransport({
      command: transport.command,
      args: transport.args,
      env: transport.env,
      ...(transport.cwd ? { cwd: transport.cwd } : {}),
      stderr: "ignore",
    });
  }
  const fetchWithAuthObservation = observedFetch(observation);
  if (transport.type === "http") {
    return new StreamableHTTPClientTransport(new URL(transport.url), {
      requestInit: { headers: transport.headers },
      fetch: fetchWithAuthObservation,
      reconnectionOptions: {
        initialReconnectionDelay: 100,
        maxReconnectionDelay: 500,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    });
  }
  return new SSEClientTransport(new URL(transport.url), {
    requestInit: { headers: transport.headers },
    fetch: fetchWithAuthObservation,
  });
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isAuthFailure(error: unknown, observation: AuthObservation): boolean {
  return (
    error instanceof UnauthorizedError ||
    (error instanceof McpError &&
      /unauthori[sz]ed|authentication required/iu.test(error.message)) ||
    observation.status === 401 ||
    observation.status === 403 ||
    (error instanceof StreamableHTTPError && error.code === 401) ||
    (error instanceof SseError && error.code === 401)
  );
}

function isTimeout(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

/** Extract the effective JSON payload from an MCP `tools/call` result. */
function extractToolResultContent(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const textBlocks = result.content.filter(
    (block): block is Extract<CallToolResult["content"][number], { type: "text" }> =>
      block.type === "text",
  );
  if (textBlocks.length === 0) return undefined;
  const text = textBlocks.map((block) => block.text).join("\n");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toolErrorMessage(result: CallToolResult): string {
  const textBlocks = result.content.filter(
    (block): block is Extract<CallToolResult["content"][number], { type: "text" }> =>
      block.type === "text",
  );
  const text = textBlocks
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || "The Control Centre tool reported an error.";
}

export class McpControlCentreGateway implements ControlCentreGateway {
  constructor(private readonly deps: McpControlCentreGatewayDeps) {}

  private resolveControlCentreServer(projectId: string): McpServer | undefined {
    const merged = mergeMcpServers(
      this.deps.getSharedMcpServers(),
      this.deps.getProjectMcpServers(projectId),
    );
    const setup = diagnoseControlCentreMcpSetup(merged);
    return setup.kind === "ready" ? setup.server : undefined;
  }

  private diagnoseControlCentreSetup(projectId: string) {
    const merged = mergeMcpServers(
      this.deps.getSharedMcpServers(),
      this.deps.getProjectMcpServers(projectId),
    );
    return diagnoseControlCentreMcpSetup(merged);
  }

  async callTool(
    projectId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ControlCentreToolOutcome> {
    const setup = this.diagnoseControlCentreSetup(projectId);
    if (setup.kind === "not-configured") {
      return {
        status: "not-configured",
        message: `No MCP server named "${CONTROL_CENTRE_MCP_SERVER_NAME}" is configured for this project.`,
      };
    }
    if (setup.kind === "disabled") {
      return {
        status: "not-configured",
        message: "The Control Centre MCP server is disabled.",
      };
    }
    let server = setup.server;

    // Apply stored OAuth authorization before constructing the transport.
    if (this.deps.applyAuthorization) {
      try {
        server = await this.deps.applyAuthorization(server);
      } catch {
        return { status: "auth-required", message: "Control Centre authentication is required." };
      }
      if (!server.enabled) {
        return {
          status: "auth-required",
          message: "Control Centre MCP server is disabled after authorization.",
        };
      }
    }

    const observation: AuthObservation = {};
    const client = new Client({ name: "poracode-cc-consultation", version: "1.0.0" });
    let transport: GatewayTransport | undefined;
    let stdioPid: number | null = null;
    let timedOut = false;
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("The operation timed out", "TimeoutError"));
    }, server.timeoutMs);
    timer.unref?.();

    try {
      transport = createTransport(server, observation);
      await raceWithAbort(
        client.connect(transport as Transport, {
          signal: controller.signal,
          timeout: server.timeoutMs,
          maxTotalTimeout: server.timeoutMs,
        }),
        controller.signal,
      );
      if (transport instanceof StdioClientTransport) stdioPid = transport.pid;

      const result = (await raceWithAbort(
        client.callTool({ name: toolName, arguments: args }, undefined, {
          signal: controller.signal,
          timeout: server.timeoutMs,
          maxTotalTimeout: server.timeoutMs,
        }),
        controller.signal,
      )) as CallToolResult;

      if (result.isError) return { status: "tool-error", message: toolErrorMessage(result) };
      return { status: "ok", content: extractToolResultContent(result) };
    } catch (error) {
      if (isAuthFailure(error, observation)) {
        return { status: "auth-required", message: "Control Centre authentication is required." };
      }
      if (timedOut || isTimeout(error)) {
        return { status: "unavailable", message: "Control Centre did not respond in time." };
      }
      return { status: "unavailable", message: "Could not reach the Control Centre MCP server." };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
      if (
        transport instanceof StreamableHTTPClientTransport &&
        transport.sessionId &&
        !controller.signal.aborted
      ) {
        await settleWithin(
          transport.terminateSession().catch(() => undefined),
          250,
        );
      }
      if (transport instanceof StdioClientTransport) {
        stdioPid ??= transport.pid;
        if (stdioPid) terminateProcessTree(stdioPid);
      }
      await settleWithin(
        client.close().catch(() => undefined),
        1_000,
      );
      if (stdioPid) terminateProcessTree(stdioPid);
    }
  }
}
