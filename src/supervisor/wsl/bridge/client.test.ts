import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WslBridgeClient, type WslLocation } from "./client";
import type { WslBridgeServer } from "./index";

/**
 * Client-side tests: stand up a real HTTP server in-process, wire it into a
 * fake `WslBridgeServer` via `ensureBridge()`, and assert the client
 * serializes requests and maps responses correctly. Platform-agnostic —
 * does NOT spawn bridge.mjs (bridge.test.ts covers that end-to-end).
 */

interface FakeBridge {
  server: Server;
  baseUrl: string;
  lastRequest: { url: string | undefined; body: unknown; auth: string | undefined };
}

async function startFakeBridge(): Promise<FakeBridge> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("unexpected listen address");
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    lastRequest: { url: undefined, body: undefined, auth: undefined },
  };
}

function makeLocation(distro = "Ubuntu"): WslLocation {
  return {
    kind: "wsl",
    distro,
    linuxPath: "/home/user/proj",
    uncPath: `\\\\wsl.localhost\\${distro}\\home\\user\\proj`,
  };
}

describe("WslBridgeClient", () => {
  let fake: FakeBridge;
  let mockServer: WslBridgeServer;

  beforeEach(async () => {
    fake = await startFakeBridge();
    mockServer = {
      ensureBridge: vi.fn<
        (
          distro: string,
        ) => Promise<{ baseUrl: string; hookUrl: string; secret: string } | undefined>
      >(async (_distro) => ({
        baseUrl: fake.baseUrl,
        hookUrl: `${fake.baseUrl}/v1/agent-event`,
        secret: "testsecret",
      })),
    } as unknown as WslBridgeServer;
  });

  afterEach(() => {
    fake.server.close();
  });

  it("readdir forwards projectRoot + path + includeChildCount and unwraps data", async () => {
    fake.server.on("request", (req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk.toString("utf8")));
      req.on("end", () => {
        fake.lastRequest = {
          url: req.url,
          body: raw ? JSON.parse(raw) : undefined,
          auth: req.headers["authorization"] as string | undefined,
        };
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              entries: [
                { name: "src", type: "directory", hasChildren: true },
                { name: "README.md", type: "file" },
              ],
            },
          }),
        );
      });
    });

    const client = new WslBridgeClient(mockServer);
    const result = await client.readdir(makeLocation(), "/home/user/proj", {
      includeChildCount: true,
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ name: "src", type: "directory", hasChildren: true });
    expect(fake.lastRequest.url).toBe("/v1/fs/readdir");
    expect(fake.lastRequest.auth).toBe("Bearer testsecret");
    expect(fake.lastRequest.body).toEqual({
      projectRoot: "/home/user/proj",
      path: "/home/user/proj",
      includeChildCount: true,
    });
  });

  it("maps bridge error envelopes to Node-style errors with `.code`", async () => {
    fake.server.on("request", (_req, res) => {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, code: "ENOENT", message: "no such directory" }));
    });

    const client = new WslBridgeClient(mockServer);
    await expect(client.readdir(makeLocation(), "/home/user/proj/missing")).rejects.toMatchObject({
      code: "ENOENT",
      message: "no such directory",
    });
  });

  it("throws EUNAVAIL when the bridge cannot be started", async () => {
    const unavailableServer = {
      ensureBridge: vi.fn<
        (
          distro: string,
        ) => Promise<{ baseUrl: string; hookUrl: string; secret: string } | undefined>
      >(async () => undefined),
    } as unknown as WslBridgeServer;
    const client = new WslBridgeClient(unavailableServer);
    await expect(client.readdir(makeLocation(), "/home/user/proj")).rejects.toMatchObject({
      code: "EUNAVAIL",
    });
  });

  it("find defaults root to projectLinuxPath when omitted", async () => {
    fake.server.on("request", (req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk.toString("utf8")));
      req.on("end", () => {
        fake.lastRequest = {
          url: req.url,
          body: raw ? JSON.parse(raw) : undefined,
          auth: req.headers["authorization"] as string | undefined,
        };
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, data: { entries: [], truncated: false } }));
      });
    });

    const client = new WslBridgeClient(mockServer);
    await client.find(makeLocation(), { maxEntries: 100, ignore: [".git"] });

    expect(fake.lastRequest.body).toEqual({
      projectRoot: "/home/user/proj",
      root: "/home/user/proj",
      maxEntries: 100,
      ignore: [".git"],
    });
  });
});
