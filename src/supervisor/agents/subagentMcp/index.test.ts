import { describe, expect, it, vi } from "vitest";
import {
  resolveSubagentMcpHttpConfigForLaunch,
  type SubagentMcpHostGatewayResolver,
  type SubagentMcpHttpConfig,
} from "./index";

const NATIVE: SubagentMcpHttpConfig = {
  url: "http://127.0.0.1:54321/mcp",
  token: "tok-abc",
  headers: { Authorization: "Bearer tok-abc" },
};

function fakeGateway(ip: string | undefined): SubagentMcpHostGatewayResolver {
  return { resolveHostGatewayIp: vi.fn<(distro: string) => string | undefined>(() => ip) };
}

describe("resolveSubagentMcpHttpConfigForLaunch", () => {
  it("returns undefined when the thread has no native config", () => {
    expect(
      resolveSubagentMcpHttpConfigForLaunch(
        undefined,
        { kind: "posix" },
        fakeGateway("172.20.0.1"),
      ),
    ).toBeUndefined();
  });

  it("passes a posix location's config through unchanged", () => {
    const result = resolveSubagentMcpHttpConfigForLaunch(NATIVE, { kind: "posix" });
    expect(result).toBe(NATIVE);
  });

  it("passes a windows location's config through unchanged", () => {
    const result = resolveSubagentMcpHttpConfigForLaunch(NATIVE, { kind: "windows" });
    expect(result).toBe(NATIVE);
  });

  it("does not invoke the gateway resolver for native locations", () => {
    const gateway = fakeGateway("172.20.0.1");
    resolveSubagentMcpHttpConfigForLaunch(NATIVE, { kind: "windows" }, gateway);
    expect(gateway.resolveHostGatewayIp).not.toHaveBeenCalled();
  });

  it("rewrites the loopback host to the WSL gateway IP, preserving port/path/token", () => {
    const gateway = fakeGateway("172.20.0.1");
    const result = resolveSubagentMcpHttpConfigForLaunch(
      NATIVE,
      { kind: "wsl", distro: "Ubuntu" },
      gateway,
    );
    expect(gateway.resolveHostGatewayIp).toHaveBeenCalledWith("Ubuntu");
    expect(result).toEqual({
      url: "http://172.20.0.1:54321/mcp",
      token: "tok-abc",
      headers: { Authorization: "Bearer tok-abc" },
    });
  });

  it("rewrites a `localhost` host too", () => {
    const result = resolveSubagentMcpHttpConfigForLaunch(
      { ...NATIVE, url: "http://localhost:54321/mcp" },
      { kind: "wsl", distro: "Ubuntu" },
      fakeGateway("10.0.0.5"),
    );
    expect(result?.url).toBe("http://10.0.0.5:54321/mcp");
  });

  it("accepts a full wsl ProjectLocation shape", () => {
    const result = resolveSubagentMcpHttpConfigForLaunch(
      NATIVE,
      {
        kind: "wsl",
        distro: "Debian",
        linuxPath: "/home/me/proj",
        uncPath: "\\\\wsl.localhost\\Debian\\home\\me\\proj",
      },
      fakeGateway("192.168.1.2"),
    );
    expect(result?.url).toBe("http://192.168.1.2:54321/mcp");
  });

  it("falls back to undefined for WSL when no gateway resolver is wired", () => {
    const result = resolveSubagentMcpHttpConfigForLaunch(NATIVE, {
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(result).toBeUndefined();
  });

  it("falls back to undefined for WSL when the gateway IP can't be resolved", () => {
    const result = resolveSubagentMcpHttpConfigForLaunch(
      NATIVE,
      { kind: "wsl", distro: "Ubuntu" },
      fakeGateway(undefined),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for WSL when the native URL is unparseable", () => {
    const result = resolveSubagentMcpHttpConfigForLaunch(
      { ...NATIVE, url: "not a url" },
      { kind: "wsl", distro: "Ubuntu" },
      fakeGateway("172.20.0.1"),
    );
    expect(result).toBeUndefined();
  });
});
