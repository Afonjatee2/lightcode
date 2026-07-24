import type {
  McpProbeEnvironment,
  McpServer,
  McpToolCallPayload,
  McpToolCallResult,
} from "@/shared/contracts";
import { mcpToolCallPayloadSchema } from "@/shared/contracts";
import { callMcpTool } from "./callMcpTool";

type HostCall = (
  server: McpServer,
  toolName: string,
  args: unknown,
  environment: McpProbeEnvironment,
  signal: AbortSignal,
) => Promise<McpToolCallResult>;

export interface McpToolCallServiceOptions {
  callHost?: HostCall;
  /**
   * Optional: attaches a stored OAuth `Authorization` header to HTTP/SSE
   * servers before calling, so an authenticated server calls successfully.
   */
  applyAuthorization?: (server: McpServer) => Promise<McpServer>;
}

function applyProjectCwd(
  server: McpServer,
  location: McpToolCallPayload["projectLocation"],
): McpServer {
  if (!location || server.transport.type !== "stdio" || server.transport.cwd) return server;
  const cwd = location.kind === "wsl" ? location.linuxPath : location.path;
  return { ...server, transport: { ...server.transport, cwd } };
}

/**
 * Renderer-facing entry point for invoking a single MCP tool call. Mirrors
 * `McpProbeService`'s lifecycle (timeout, abort, OAuth header injection) but
 * calls a tool instead of only listing them.
 *
 * Scoped to host execution: Control Centre (the only current consumer) is
 * always a remote HTTP/SSE MCP server, so there is no WSL-worker delegation
 * path here (unlike `McpProbeService.probeWsl`). If a future project-local
 * stdio MCP server needs campaign-style tool calls under WSL, add a worker
 * path analogous to `runWslProbeWorker` at that point.
 */
export class McpToolCallService {
  private readonly callHost: HostCall;
  private readonly applyAuthorization: ((server: McpServer) => Promise<McpServer>) | undefined;
  private readonly active = new Set<AbortController>();

  constructor(options: McpToolCallServiceOptions = {}) {
    this.callHost = options.callHost ?? callMcpTool;
    this.applyAuthorization = options.applyAuthorization;
  }

  async call(input: McpToolCallPayload): Promise<McpToolCallResult> {
    const payload = mcpToolCallPayloadSchema.parse(input);
    const environment: McpProbeEnvironment = {
      runtime: "host",
      projectScoped: payload.projectLocation !== undefined,
    };
    let server = applyProjectCwd(payload.server, payload.projectLocation);
    if (this.applyAuthorization) {
      server = await this.applyAuthorization(server).catch(() => server);
    }
    const controller = new AbortController();
    this.active.add(controller);
    const timeout = setTimeout(
      () => controller.abort(new DOMException("The operation timed out", "TimeoutError")),
      server.timeoutMs,
    );
    timeout.unref?.();

    try {
      return await this.callHost(server, payload.toolName, payload.args, environment, controller.signal);
    } catch {
      return controller.signal.aborted
        ? {
            status: "unavailable",
            latencyMs: server.timeoutMs,
            environment,
            error: { code: "timeout", message: "Connection timed out." },
          }
        : {
            status: "unavailable",
            latencyMs: 0,
            environment,
            error: { code: "connection-failed", message: "Could not connect to the MCP server." },
          };
    } finally {
      clearTimeout(timeout);
      this.active.delete(controller);
    }
  }

  dispose(): void {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }
}
