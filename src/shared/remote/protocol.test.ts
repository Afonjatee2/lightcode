import { describe, expect, it } from "vitest";
import { defaultSharedSettings } from "../settings";
import {
  pickRemoteSettings,
  remoteSettingsPatchSchema,
  remoteShellSnapshotSchema,
} from "./protocol";

describe("remote project snapshots", () => {
  it("strip MCP definitions because env and headers may contain secrets", () => {
    const snapshot = remoteShellSnapshotSchema.parse({
      snapshotSeq: 1,
      projects: [
        {
          id: "project-1",
          name: "Project",
          location: { kind: "posix", path: "/repo" },
          createdAt: "2026-01-01T00:00:00.000Z",
          mcpServers: [
            {
              id: "secret-server",
              name: "private",
              description: "",
              enabled: true,
              timeoutMs: 30_000,
              transport: {
                type: "http",
                url: "https://example.test/mcp",
                headers: { Authorization: "Bearer secret" },
              },
            },
          ],
        },
      ],
      threads: [],
      runtimeSummariesByThread: {},
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.projects[0]).not.toHaveProperty("mcpServers");
    expect(JSON.stringify(snapshot)).not.toContain("Bearer secret");
  });
});

describe("remote settings", () => {
  it("exposes composer MCP enablement without exposing custom MCP definitions", () => {
    const settings = pickRemoteSettings({
      ...defaultSharedSettings,
      enabledMcpServers: { browser: true, crossagents: false, "computer-use": true },
      disabledBuiltInMcpServers: { chrome: true },
      mcpServers: [
        {
          id: "secret-server",
          name: "private",
          description: "",
          enabled: true,
          timeoutMs: 30_000,
          transport: {
            type: "http",
            url: "https://example.test/mcp",
            headers: { Authorization: "Bearer secret" },
          },
        },
      ],
    });

    expect(settings.enabledMcpServers).toEqual({
      browser: true,
      crossagents: false,
      "computer-use": true,
    });
    expect(settings.disabledBuiltInMcpServers).toEqual({ chrome: true });
    expect(settings).not.toHaveProperty("mcpServers");
    expect(JSON.stringify(settings)).not.toContain("Bearer secret");
  });

  it("does not inject empty MCP maps into an unrelated settings patch", () => {
    expect(remoteSettingsPatchSchema.parse({ titleGenProvider: "claude" })).toEqual({
      titleGenProvider: "claude",
    });
  });
});
