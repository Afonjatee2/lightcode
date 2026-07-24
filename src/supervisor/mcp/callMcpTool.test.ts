import { createServer } from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import type { McpServer } from "@/shared/contracts";
import { callMcpTool } from "./callMcpTool";

const environment = { runtime: "host", projectScoped: false } as const;
const servers: import("node:http").Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

function stdioServer(script: string, timeoutMs = 2_000): McpServer {
  return {
    id: "stdio-test",
    name: "stdio-test",
    description: "",
    enabled: true,
    timeoutMs,
    transport: { type: "stdio", command: process.execPath, args: ["-e", script], env: {} },
  };
}

const STDIO_FIXTURE = String.raw`
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\n");
    if (index < 0) break;
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture-server", version: "1.0.0" }
        }
      }) + "\n");
    } else if (message.method === "tools/call") {
      const { name, arguments: args } = message.params;
      if (name === "boom") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: "campaign group not found" }], isError: true }
        }) + "\n");
      } else if (name === "structured") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [], structuredContent: { echoedId: args.id } }
        }) + "\n");
      } else {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: JSON.stringify({ echoedId: args.id }) }] }
        }) + "\n");
      }
    }
  }
});
`;

describe("callMcpTool", () => {
  it("connects, calls the tool, and returns parsed JSON text content", async () => {
    const result = await callMcpTool(
      stdioServer(STDIO_FIXTURE),
      "get_campaign_context",
      { id: "group-1" },
      environment,
    );

    expect(result).toMatchObject({ status: "ok", content: { echoedId: "group-1" } });
  });

  it("prefers structuredContent over the text content block", async () => {
    const result = await callMcpTool(
      stdioServer(STDIO_FIXTURE),
      "structured",
      { id: "group-2" },
      environment,
    );

    expect(result).toMatchObject({ status: "ok", content: { echoedId: "group-2" } });
  });

  it("maps a tool-level isError result to the tool-error state", async () => {
    const result = await callMcpTool(stdioServer(STDIO_FIXTURE), "boom", { id: "x" }, environment);

    expect(result).toMatchObject({ status: "tool-error", message: "campaign group not found" });
  });

  it("maps a connection failure to the unavailable state", async () => {
    const server: McpServer = {
      id: "bad-command",
      name: "bad-command",
      description: "",
      enabled: true,
      timeoutMs: 2_000,
      transport: { type: "stdio", command: "/no/such/binary", args: [], env: {} },
    };

    const result = await callMcpTool(server, "get_campaign_context", { id: "x" }, environment);

    expect(result).toMatchObject({
      status: "unavailable",
      error: { code: "command-not-found" },
    });
  });

  it("classifies an HTTP 401 challenge as auth-required without leaking headers", async () => {
    const secret = "top-secret-token";
    const httpServer = createServer((_request, response) => {
      response.statusCode = 401;
      response.setHeader("www-authenticate", "Bearer");
      response.end();
    });
    servers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");

    const server: McpServer = {
      id: "auth-test",
      name: "auth-test",
      description: "",
      enabled: true,
      timeoutMs: 2_000,
      transport: {
        type: "http",
        url: `http://127.0.0.1:${address.port}/mcp`,
        headers: { authorization: `Bearer ${secret}` },
      },
    };

    const result = await callMcpTool(server, "get_campaign_context", { id: "x" }, environment);

    expect(result).toMatchObject({ status: "auth-required" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
