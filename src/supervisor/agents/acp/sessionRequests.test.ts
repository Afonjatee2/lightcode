import type { CreateElicitationRequest, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, ThreadConfig } from "@/shared/contracts";
import { createAcpMapperState } from "./canonicalMapping";
import { AcpSessionRequests } from "./sessionRequests";

function permissionRequest(): RequestPermissionRequest {
  return {
    sessionId: "session-1",
    toolCall: {
      toolCallId: "tool-1",
      title: "Run tests",
      kind: "execute",
      rawInput: { command: "pnpm test" },
    },
    options: [
      { optionId: "once", name: "Allow once", kind: "allow_once" },
      { optionId: "always", name: "Allow always", kind: "allow_always" },
    ],
  };
}

function formElicitation(): CreateElicitationRequest {
  return {
    mode: "form",
    sessionId: "session-1",
    message: "Choose deployment scope",
    requestedSchema: {
      type: "object",
      properties: {
        scope: { type: "string", title: "Scope" },
        count: { type: "integer" },
        confirm: { type: "boolean" },
        tags: { type: "array", items: { type: "string", enum: ["fast", "safe"] } },
      },
    },
  };
}

function urlElicitation(): CreateElicitationRequest {
  return {
    mode: "url",
    sessionId: "session-1",
    message: "Authenticate",
    elicitationId: "elicit-1",
    url: "https://example.com/auth",
  };
}

function makeRequests(
  overrides: {
    config?: ThreadConfig;
    availableModeIds?: string[];
  } = {},
) {
  const config = overrides.config ?? {
    model: "model-a",
    mode: "agent",
    approvalPolicy: "default",
  };
  const availableModeIds = overrides.availableModeIds ?? ["default", "plan", "yolo"];
  const emitRuntimeEvents = vi.fn<(events: RuntimeEvent[]) => void>();
  const setRequestAttention = vi.fn<(attention: "needs_approval" | "needs_reply") => void>();
  const requests = new AcpSessionRequests({
    threadId: "thread-1",
    getPermissionContext: () => ({ config, availableModeIds }),
    ensureMapperState: () => createAcpMapperState("thread-1"),
    emitRuntimeEvents,
    setRequestAttention,
  });
  return { emitRuntimeEvents, requests, setRequestAttention };
}

describe("AcpSessionRequests permissions", () => {
  it.each(["never", "yolo", "bypassPermissions"])(
    "auto-approves %s when the agent has no matching native mode",
    async (approvalPolicy) => {
      const { emitRuntimeEvents, requests, setRequestAttention } = makeRequests({
        config: { model: "model-a", mode: "agent", approvalPolicy },
        availableModeIds: ["agent"],
      });

      await expect(requests.requestPermission(permissionRequest())).resolves.toEqual({
        outcome: { outcome: "selected", optionId: "always" },
      });
      expect(emitRuntimeEvents).not.toHaveBeenCalled();
      expect(setRequestAttention).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "an ordinary approval policy",
      config: { model: "model-a", mode: "agent", approvalPolicy: "default" },
      availableModeIds: ["agent"],
    },
    {
      name: "a matching native permission mode",
      config: { model: "model-a", mode: "agent", approvalPolicy: "never" },
      availableModeIds: ["agent", "yolo"],
    },
    {
      name: "plan mode",
      config: { model: "model-a", mode: "plan", approvalPolicy: "never" },
      availableModeIds: ["agent"],
    },
  ] satisfies Array<{ name: string; config: ThreadConfig; availableModeIds: string[] }>)(
    "opens a request for $name",
    async ({ config, availableModeIds }) => {
      const { requests, setRequestAttention } = makeRequests({ config, availableModeIds });

      const response = requests.requestPermission(permissionRequest());

      expect(setRequestAttention).toHaveBeenCalledExactlyOnceWith("needs_approval");
      requests.resolve("acp-perm-0", { optionId: "once" });
      await expect(response).resolves.toEqual({
        outcome: { outcome: "selected", optionId: "once" },
      });
    },
  );

  it("maps an interactive permission and resolves the selected option", async () => {
    const { emitRuntimeEvents, requests, setRequestAttention } = makeRequests();

    const response = requests.requestPermission(permissionRequest());

    expect(emitRuntimeEvents).toHaveBeenCalledWith([
      {
        type: "request.opened",
        threadId: "thread-1",
        requestId: "acp-perm-0",
        requestType: "command_execution_approval",
        payload: {
          summary: "Run tests",
          details: {
            toolName: "execute",
            displayName: "command",
            input: { command: "pnpm test" },
          },
          options: [
            { optionId: "once", label: "Allow once" },
            { optionId: "always", label: "Allow always" },
          ],
        },
      },
    ]);
    expect(setRequestAttention).toHaveBeenCalledWith("needs_approval");

    requests.resolve("acp-perm-0", { optionId: "once" });
    await expect(response).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "once" },
    });
  });
});

describe("AcpSessionRequests elicitations", () => {
  it("maps and normalizes a form response, including its canonical answer item", async () => {
    const { emitRuntimeEvents, requests, setRequestAttention } = makeRequests();

    const response = requests.createElicitation(formElicitation());

    expect(emitRuntimeEvents).toHaveBeenCalledWith([
      {
        type: "request.opened",
        threadId: "thread-1",
        requestId: "acp-elicit-0",
        requestType: "tool_user_input",
        payload: {
          summary: "Choose deployment scope",
          details: {
            acpElicitation: expect.objectContaining({
              mode: "form",
              message: "Choose deployment scope",
            }),
          },
        },
      },
    ]);
    expect(setRequestAttention).toHaveBeenCalledWith("needs_reply");

    requests.resolve("acp-elicit-0", {
      action: "accept",
      content: {
        scope: "Scope A",
        count: 2,
        confirm: true,
        tags: ["fast"],
        ignored: "not in schema",
      },
    });

    await expect(response).resolves.toEqual({
      action: "accept",
      content: {
        scope: "Scope A",
        count: 2,
        confirm: true,
        tags: ["fast"],
      },
    });
    expect(emitRuntimeEvents).toHaveBeenLastCalledWith([
      expect.objectContaining({
        type: "item.started",
        itemId: "acp-question-answer-acp-elicit-0",
        itemType: "question_answer",
      }),
      {
        type: "item.completed",
        threadId: "thread-1",
        itemId: "acp-question-answer-acp-elicit-0",
      },
    ]);
  });

  it("resolves a URL elicitation from its completion notification exactly once", async () => {
    const { emitRuntimeEvents, requests } = makeRequests();
    const response = requests.createElicitation(urlElicitation());
    emitRuntimeEvents.mockClear();

    requests.completeElicitation({ elicitationId: "unknown" });
    expect(emitRuntimeEvents).not.toHaveBeenCalled();

    requests.completeElicitation({ elicitationId: "elicit-1" });

    await expect(response).resolves.toEqual({ action: "accept" });
    expect(emitRuntimeEvents).toHaveBeenLastCalledWith([
      {
        type: "request.resolved",
        threadId: "thread-1",
        requestId: "acp-elicit-0",
        outcome: "answered",
      },
    ]);

    emitRuntimeEvents.mockClear();
    requests.completeElicitation({ elicitationId: "elicit-1" });
    expect(emitRuntimeEvents).not.toHaveBeenCalled();
  });
});

describe("AcpSessionRequests cancellation", () => {
  it("cancels every pending request and clears URL completion lookup", async () => {
    const { emitRuntimeEvents, requests } = makeRequests();
    const permission = requests.requestPermission(permissionRequest());
    const elicitation = requests.createElicitation(urlElicitation());
    emitRuntimeEvents.mockClear();

    requests.cancelPending();

    await expect(permission).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    await expect(elicitation).resolves.toEqual({ action: "cancel" });
    expect(emitRuntimeEvents).toHaveBeenCalledOnce();
    expect(emitRuntimeEvents).toHaveBeenCalledWith([
      {
        type: "request.resolved",
        threadId: "thread-1",
        requestId: "acp-perm-0",
        outcome: "cancelled",
      },
      {
        type: "request.resolved",
        threadId: "thread-1",
        requestId: "acp-elicit-0",
        outcome: "cancelled",
      },
    ]);

    emitRuntimeEvents.mockClear();
    requests.completeElicitation({ elicitationId: "elicit-1" });
    requests.cancelPending();
    expect(emitRuntimeEvents).not.toHaveBeenCalled();
  });
});
