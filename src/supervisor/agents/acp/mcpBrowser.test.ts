import { describe, expect, it } from "vitest";
import { gateAcpHttpMcpServers, type AcpHttpMcpServer } from "./mcpBrowser";

const servers: AcpHttpMcpServer[] = [
  { type: "http", name: "browser", url: "http://127.0.0.1:9100/mcp", headers: [] },
  { type: "http", name: "subagents", url: "http://127.0.0.1:9200/mcp", headers: [] },
];

describe("gateAcpHttpMcpServers", () => {
  it("keeps HTTP servers when the agent advertises mcpCapabilities.http", () => {
    expect(gateAcpHttpMcpServers(servers, { http: true })).toEqual(servers);
  });

  it("drops HTTP servers when the agent does not advertise http support", () => {
    expect(gateAcpHttpMcpServers(servers, { http: false })).toEqual([]);
    expect(gateAcpHttpMcpServers(servers, { sse: true })).toEqual([]);
    expect(gateAcpHttpMcpServers(servers, {})).toEqual([]);
    expect(gateAcpHttpMcpServers(servers, undefined)).toEqual([]);
  });

  it("returns the empty input unchanged regardless of capabilities", () => {
    expect(gateAcpHttpMcpServers([], undefined)).toEqual([]);
    expect(gateAcpHttpMcpServers([], { http: true })).toEqual([]);
  });
});
