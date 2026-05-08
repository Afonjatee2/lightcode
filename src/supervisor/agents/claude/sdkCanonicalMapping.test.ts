import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import {
  createClaudeMapperState,
  mapClaudePermissionRequest,
  mapClaudeQuestionRequest,
  mapClaudeSdkMessage,
  parseClaudeQuestions,
  startClaudeTurn,
} from "./sdkCanonicalMapping";

function streamEvent(event: Record<string, unknown>): SDKMessage {
  return { type: "stream_event", session_id: "claude-session", event } as unknown as SDKMessage;
}

describe("sdkCanonicalMapping — prompt content", () => {
  it("starts a turn with the optimistic user message id and mapped attachments", () => {
    const state = createClaudeMapperState("thread-1");

    const events = startClaudeTurn(
      state,
      "turn-1",
      "see this",
      [
        { kind: "text", content: "see this" },
        { kind: "attachment", path: "C:\\tmp\\image.png", mimeType: "image/png" },
      ],
      "user-optimistic",
    );

    expect(events).toEqual([
      { type: "turn.started", threadId: "thread-1", turnId: "turn-1" },
      {
        type: "item.started",
        threadId: "thread-1",
        itemId: "user-optimistic",
        itemType: "user_message",
        payload: {
          content: [
            { kind: "text", text: "see this" },
            {
              kind: "file",
              path: "C:\\tmp\\image.png",
              name: "image.png",
              source: "attachment",
            },
          ],
        },
      },
      { type: "item.completed", threadId: "thread-1", itemId: "user-optimistic" },
    ]);
  });
});

describe("sdkCanonicalMapping — text streaming", () => {
  it("opens an assistant item on the first text delta and completes it on stop", () => {
    const state = createClaudeMapperState("thread-1");

    const delta = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      state,
    );
    const stop = mapClaudeSdkMessage(streamEvent({ type: "content_block_stop", index: 0 }), state);

    expect(delta).toHaveLength(2);
    expect(delta[0]).toMatchObject({ type: "item.started", itemType: "assistant_message" });
    expect(delta[1]).toMatchObject({
      type: "content.delta",
      stream: "assistant_text",
      delta: "Hello",
    });
    expect(stop).toHaveLength(1);
    expect(stop[0]).toMatchObject({ type: "item.completed" });
  });

  it("does not duplicate the final assistant snapshot after streamed text completes", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      state,
    );
    mapClaudeSdkMessage(streamEvent({ type: "content_block_stop", index: 0 }), state);

    const snapshot = mapClaudeSdkMessage(
      {
        type: "assistant",
        session_id: "claude-session",
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      } as unknown as SDKMessage,
      state,
    );

    expect(snapshot).toEqual([]);
  });
});

describe("sdkCanonicalMapping — tool use", () => {
  it("classifies TodoWrite as a plan item and updates steps from streamed input JSON", () => {
    const state = createClaudeMapperState("thread-1");

    const started = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_todo", name: "TodoWrite", input: {} },
      }),
      state,
    );
    const updated = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json:
            '{"todos":[{"content":"First task","status":"in_progress"},{"content":"Done","status":"completed"}]}',
        },
      }),
      state,
    );

    expect(started[0]).toMatchObject({
      type: "item.started",
      itemType: "plan",
      itemId: "toolu_todo",
    });
    expect(updated[0]).toMatchObject({
      type: "item.updated",
      itemId: "toolu_todo",
      payload: {
        steps: [
          { step: "First task", status: "in_progress" },
          { step: "Done", status: "completed" },
        ],
      },
    });
  });

  it("streams command tool results to command_output and completes the item", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_bash",
          name: "Bash",
          input: { command: "pwd" },
        },
      }),
      state,
    );

    const events = mapClaudeSdkMessage(
      {
        type: "user",
        session_id: "claude-session",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_bash", content: "C:\\repo" }],
        },
      } as unknown as SDKMessage,
      state,
    );

    expect(events).toEqual([
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "toolu_bash",
        stream: "command_output",
        delta: "C:\\repo",
      },
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "toolu_bash",
        payload: { command: "pwd" },
      },
      { type: "item.completed", threadId: "thread-1", itemId: "toolu_bash" },
    ]);
  });
});

describe("sdkCanonicalMapping — turn completion", () => {
  it("maps a successful result to turn.completed", () => {
    const state = createClaudeMapperState("thread-1");
    startClaudeTurn(state, "turn-1", "hi", undefined);

    const events = mapClaudeSdkMessage(
      { type: "result", subtype: "success", session_id: "claude-session" } as unknown as SDKMessage,
      state,
    );

    expect(events).toEqual([
      { type: "turn.completed", threadId: "thread-1", turnId: "turn-1", state: "completed" },
    ]);
  });
});

describe("sdkCanonicalMapping — requests", () => {
  it("maps Bash permissions to command execution approvals", () => {
    expect(
      mapClaudePermissionRequest({
        threadId: "thread-1",
        requestId: "perm-1",
        toolName: "Bash",
        toolInput: { command: "pnpm test" },
      }),
    ).toMatchObject({
      type: "request.opened",
      requestId: "perm-1",
      requestType: "command_execution_approval",
      payload: { summary: "Bash: pnpm test" },
    });
  });

  it("parses AskUserQuestion input and exposes single-question options", () => {
    const questions = parseClaudeQuestions({
      questions: [
        {
          question: "Choose one",
          header: "Choice",
          multiSelect: true,
          options: [{ label: "A", description: "Alpha" }],
        },
      ],
    });

    expect(
      mapClaudeQuestionRequest({ threadId: "thread-1", requestId: "q-1", questions }),
    ).toMatchObject({
      type: "request.opened",
      requestType: "tool_user_input",
      payload: {
        summary: "Choose one",
        multiSelect: true,
        options: [{ optionId: "A", label: "A", description: "Alpha" }],
      },
    });
  });
});
