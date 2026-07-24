import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpProbeEnvironment, McpServer } from "@/shared/contracts";
import type { McpToolCallResult } from "@/shared/contracts/mcpToolCall";
import { terminateProcessTree } from "@/shared/processTree";
import {
  type AuthObservation,
  type McpClientTransport,
  classifyMcpConnectionFailure,
  closeClientWithTimeout,
  createMcpClientTransport,
  raceWithAbort,
  settleWithin,
} from "./mcpConnection";

/**
 * Extracts the effective JSON payload from an MCP `tools/call` result.
 * Prefers `structuredContent` (the modern, typed path); falls back to
 * parsing the first text content block as JSON, then to the raw text.
 */
export function extractToolResultContent(result: CallToolResult): unknown {
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
  const text = textBlocks.map((block) => block.text).join("\n").trim();
  return text || "The MCP tool reported an error.";
}

/**
 * Connects to a resolved `McpServer`, invokes a single tool, and disconnects.
 * Mirrors {@link probeMcpServer}'s connection lifecycle but performs a real
 * `tools/call` instead of a handshake-only discovery pass.
 *
 * Control Centre's MCP server is always reached over HTTP/SSE (a remote,
 * hosted endpoint) so, unlike `McpProbeService`, this has no WSL-worker
 * delegation path — host-only is the complete, correct scope for campaign
 * tool calls.
 */
export async function callMcpTool(
  server: McpServer,
  toolName: string,
  args: unknown,
  environment: McpProbeEnvironment,
  externalSignal?: AbortSignal,
): Promise<McpToolCallResult> {
  const startedAt = Date.now();
  const observation: AuthObservation = {};
  const client = new Client({ name: "poracode-mcp-tool-call", version: "1.0.0" });
  let transport: McpClientTransport | undefined;
  let stdioPid: number | null = null;
  let timedOut = false;
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("The operation timed out", "TimeoutError"));
  }, server.timeoutMs);
  timer.unref?.();

  try {
    transport = createMcpClientTransport(server, observation);
    const connect = client.connect(transport as Transport, {
      signal: controller.signal,
      timeout: server.timeoutMs,
      maxTotalTimeout: server.timeoutMs,
    });
    await raceWithAbort(connect, controller.signal);
    if (transport instanceof StdioClientTransport) stdioPid = transport.pid;

    const result = await raceWithAbort(
      client.callTool(
        { name: toolName, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { signal: controller.signal, timeout: server.timeoutMs, maxTotalTimeout: server.timeoutMs },
      ) as Promise<CallToolResult>,
      controller.signal,
    );

    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (result.isError) {
      return { status: "tool-error", message: toolErrorMessage(result), latencyMs, environment };
    }
    return { status: "ok", content: extractToolResultContent(result), latencyMs, environment };
  } catch (error) {
    const classified = classifyMcpConnectionFailure(error, observation, timedOut);
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return classified.code === "auth-required"
      ? { status: "auth-required", latencyMs, environment, error: { ...classified, code: "auth-required" } }
      : { status: "unavailable", latencyMs, environment, error: classified };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
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
    await closeClientWithTimeout(client);
    if (stdioPid) terminateProcessTree(stdioPid);
  }
}
