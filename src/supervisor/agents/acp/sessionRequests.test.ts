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

function questionPermissionRequest(): RequestPermissionRequest {
  return {
    sessionId: "session-1",
    toolCall: {
      toolCallId: "question-1",
      title: "Ask user 2 questions",
      kind: "other",
      rawInput: {
        questions: [
          {
            header: "Scope",
            question: "Which scope should be implemented?",
            options: [
              { label: "Focused", description: "Implement only the requested feature." },
              { label: "Broad", description: "Include adjacent improvements." },
            ],
          },
          {
            header: "Checks",
            question: "Which checks should run?",
            multiSelect: true,
            options: [
              { label: "Tests", description: "Run focused tests." },
              { label: "Lint", description: "Run lint checks." },
            ],
          },
        ],
      },
    },
    options: [
      { optionId: "proceed_once", name: "Submit", kind: "allow_once" },
      { optionId: "cancel", name: "Cancel", kind: "reject_once" },
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
  it("maps Qwen AskUserQuestion permissions to a reply form and returns indexed answers", async () => {
    const { emitRuntimeEvents, requests, setRequestAttention } = makeRequests({
      config: { model: "model-a", mode: "agent", approvalPolicy: "never" },
      availableModeIds: ["agent"],
    });

    const response = requests.requestPermission(questionPermissionRequest());

    expect(setRequestAttention).toHaveBeenCalledExactlyOnceWith("needs_reply");
    expect(emitRuntimeEvents).toHaveBeenCalledWith([
      {
        type: "request.opened",
        threadId: "thread-1",
        requestId: "acp-perm-0",
        requestType: "tool_user_input",
        payload: {
          summary: "Which scope should be implemented?",
          details: {
            userInputForm: {
              questions: [
                {
                  id: "0",
                  header: "Scope",
                  question: "Which scope should be implemented?",
                  options: [
                    {
                      optionId: "Focused",
                      label: "Focused",
                      description: "Implement only the requested feature.",
                    },
                    {
                      optionId: "Broad",
                      label: "Broad",
                      description: "Include adjacent improvements.",
                    },
                  ],
                  multiSelect: false,
                },
                {
                  id: "1",
                  header: "Checks",
                  question: "Which checks should run?",
                  options: [
                    {
                      optionId: "Tests",
                      label: "Tests",
                      description: "Run focused tests.",
                    },
                    {
                      optionId: "Lint",
                      label: "Lint",
                      description: "Run lint checks.",
                    },
                  ],
                  multiSelect: true,
                },
              ],
            },
          },
        },
      },
    ]);

    requests.resolve("acp-perm-0", {
      answers: {
        "0": "Focused",
        "1": ["Tests", "Lint"],
      },
    });

    await expect(response).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "proceed_once" },
      answers: { "0": "Focused", "1": "Tests, Lint" },
    });
    expect(emitRuntimeEvents).toHaveBeenCalledWith([
      {
        type: "item.started",
        threadId: "thread-1",
        itemId: "acp-question-answer-acp-perm-0",
        itemType: "question_answer",
        payload: {
          questions: [
            {
              header: "Scope",
              question: "Which scope should be implemented?",
              selected: [
                { label: "Focused", description: "Implement only the requested feature." },
              ],
            },
            {
              header: "Checks",
              question: "Which checks should run?",
              selected: [
                { label: "Tests", description: "Run focused tests." },
                { label: "Lint", description: "Run lint checks." },
              ],
            },
          ],
        },
      },
      {
        type: "item.completed",
        threadId: "thread-1",
        itemId: "acp-question-answer-acp-perm-0",
      },
    ]);
  });

  it("cancels Qwen AskUserQuestion without forwarding answers", async () => {
    const { emitRuntimeEvents, requests } = makeRequests();
    const response = requests.requestPermission(questionPermissionRequest());

    requests.resolve("acp-perm-0", { action: "cancel" });

    await expect(response).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    expect(emitRuntimeEvents).toHaveBeenLastCalledWith([
      {
        type: "request.resolved",
        threadId: "thread-1",
        requestId: "acp-perm-0",
        outcome: "answered",
      },
    ]);
  });

  it("reports when a permission request is no longer pending", () => {
    const { emitRuntimeEvents, requests } = makeRequests();

    expect(requests.resolve("acp-perm-missing", { optionId: "proceed_once" })).toBe(false);
    expect(emitRuntimeEvents).not.toHaveBeenCalled();
  });

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
    expect(emitRuntimeEvents).toHaveBeenCalledWith([
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
