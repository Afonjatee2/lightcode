import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpToolCallPayload, McpToolCallResult, Project } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { resolveControlCentreServer, useControlCentreTool } from "./useControlCentreTool";

const mocks = vi.hoisted(() => ({
  callMcpTool: vi.fn<(payload: McpToolCallPayload) => Promise<McpToolCallResult>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({ callMcpTool: mocks.callMcpTool }),
}));

const schema = z.object({ value: z.string() });

const controlCentreServer = {
  id: "cc-1",
  name: "control-centre",
  description: "",
  enabled: true,
  timeoutMs: 30_000,
  transport: { type: "http" as const, url: "https://cc.example.com/mcp", headers: {} },
};

function campaignProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Client Campaign",
    location: { kind: "posix", path: "/repo" },
    createdAt: "2026-07-01T00:00:00.000Z",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: "group-1",
      clientName: "Client",
      campaignName: "Launch",
    },
    mcpServers: [controlCentreServer],
    ...overrides,
  };
}

describe("resolveControlCentreServer", () => {
  it("finds the control-centre server by name, case-insensitively", () => {
    const project = campaignProject({
      mcpServers: [{ ...controlCentreServer, name: "Control-Centre" }],
    });
    expect(resolveControlCentreServer(project, [])?.name).toBe("Control-Centre");
  });

  it("finds the control-centre server when underscores separate the words", () => {
    const project = campaignProject({
      mcpServers: [{ ...controlCentreServer, name: "Control_Centre" }],
    });
    expect(resolveControlCentreServer(project, [])?.name).toBe("Control_Centre");
  });

  it("returns undefined when no project is given", () => {
    expect(resolveControlCentreServer(undefined, [controlCentreServer])).toBeUndefined();
  });

  it("returns undefined when no control-centre server is configured", () => {
    const project = campaignProject({ mcpServers: [] });
    expect(resolveControlCentreServer(project, [])).toBeUndefined();
  });

  it("ignores a disabled control-centre server", () => {
    const project = campaignProject({
      mcpServers: [{ ...controlCentreServer, enabled: false }],
    });
    expect(resolveControlCentreServer(project, [])).toBeUndefined();
  });
});

describe("useControlCentreTool", () => {
  beforeEach(() => {
    mocks.callMcpTool.mockReset();
    useAppStore.setState((state) => ({ ...state, projects: [campaignProject()] }));
    useSharedSettings.setState({ mcpServers: [] });
  });

  it("reports empty without calling the bridge when skip is true", async () => {
    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: { id: "group-1" },
        schema,
        skip: true,
      }),
    );

    expect(result.current.state).toEqual({ status: "empty" });
    expect(mocks.callMcpTool).not.toHaveBeenCalled();
  });

  it("starts in loading state, then resolves to ready with parsed data", async () => {
    mocks.callMcpTool.mockResolvedValue({
      status: "ok",
      content: { value: "hello" },
      latencyMs: 5,
      environment: { runtime: "host", projectScoped: false },
    });

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: { id: "group-1" },
        schema,
        skip: false,
      }),
    );

    expect(result.current.state).toEqual({ status: "loading" });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", data: { value: "hello" } }),
    );
    expect(mocks.callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "get_campaign_context", args: { id: "group-1" } }),
    );
  });

  it("surfaces a schema mismatch as a distinct error state, not a crash", async () => {
    mocks.callMcpTool.mockResolvedValue({
      status: "ok",
      content: { unexpected: true },
      latencyMs: 5,
      environment: { runtime: "host", projectScoped: false },
    });

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: {},
        schema,
        skip: false,
      }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });

  it("maps auth-required to the unauthorized state", async () => {
    mocks.callMcpTool.mockResolvedValue({
      status: "auth-required",
      latencyMs: 5,
      environment: { runtime: "host", projectScoped: false },
      error: { code: "auth-required", message: "Auth required" },
    });

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: {},
        schema,
        skip: false,
      }),
    );

    await waitFor(() => expect(result.current.state).toEqual({ status: "unauthorized" }));
  });

  it("maps a connection failure to the unavailable state with a message", async () => {
    mocks.callMcpTool.mockResolvedValue({
      status: "unavailable",
      latencyMs: 5,
      environment: { runtime: "host", projectScoped: false },
      error: { code: "connection-failed", message: "Could not connect to the MCP server." },
    });

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: {},
        schema,
        skip: false,
      }),
    );

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "unavailable",
        reason: "connection-failed",
        message: "Could not connect to the MCP server.",
      }),
    );
  });

  it("maps a tool-level error to the error state with its message", async () => {
    mocks.callMcpTool.mockResolvedValue({
      status: "tool-error",
      latencyMs: 5,
      environment: { runtime: "host", projectScoped: false },
      message: "Campaign group not found.",
    });

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: {},
        schema,
        skip: false,
      }),
    );

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "error",
        message: "Campaign group not found.",
      }),
    );
  });

  it("reports unavailable when no Control Centre MCP server is configured", async () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [campaignProject({ mcpServers: [] })],
    }));

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: {},
        schema,
        skip: false,
      }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("unavailable"));
    expect(result.current.state).toMatchObject({
      status: "unavailable",
      reason: "not-configured",
    });
    expect(mocks.callMcpTool).not.toHaveBeenCalled();
  });

  it("reports disabled when a matching Control Centre MCP server is turned off", async () => {
    useAppStore.setState((state) => ({
      ...state,
      projects: [
        campaignProject({
          mcpServers: [{ ...controlCentreServer, name: "Control_Centre", enabled: false }],
        }),
      ],
    }));

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: {},
        schema,
        skip: false,
      }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("unavailable"));
    expect(result.current.state).toMatchObject({
      status: "unavailable",
      reason: "disabled",
    });
    expect(mocks.callMcpTool).not.toHaveBeenCalled();
  });

  it("refetch triggers another bridge call", async () => {
    mocks.callMcpTool.mockResolvedValue({
      status: "ok",
      content: { value: "hello" },
      latencyMs: 5,
      environment: { runtime: "host", projectScoped: false },
    });

    const { result } = renderHook(() =>
      useControlCentreTool({
        projectId: "project-1",
        toolName: "get_campaign_context",
        args: {},
        schema,
        skip: false,
      }),
    );

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(mocks.callMcpTool).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());

    await waitFor(() => expect(mocks.callMcpTool).toHaveBeenCalledTimes(2));
  });
});
