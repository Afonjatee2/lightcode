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

function streamEventWithParent(
  event: Record<string, unknown>,
  parentToolUseId: string,
): SDKMessage {
  return {
    type: "stream_event",
    session_id: "claude-session",
    parent_tool_use_id: parentToolUseId,
    event,
  } as unknown as SDKMessage;
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

  it("surfaces a Claude /goal command as a shared goal chat item", () => {
    const state = createClaudeMapperState("thread-1");

    const events = startClaudeTurn(
      state,
      "turn-goal",
      "/goal ship unified GUI goal support",
      undefined,
      "user-goal",
    );

    expect(events).toContainEqual({
      type: "item.started",
      threadId: "thread-1",
      itemId: "goal-turn-goal",
      itemType: "goal",
      payload: {
        action: "set",
        objective: "ship unified GUI goal support",
        status: "active",
      },
    });
    expect(events).toContainEqual({
      type: "item.completed",
      threadId: "thread-1",
      itemId: "goal-turn-goal",
    });
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
        type: "message_start",
        message: { id: "msg_1", role: "assistant", content: [] },
      }),
      state,
    );
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
        message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "Hello" }] },
      } as unknown as SDKMessage,
      state,
    );

    expect(snapshot).toEqual([]);
  });

  it("does not duplicate a final assistant snapshot when a replayed message_start reset the index map", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "message_start",
        message: { id: "msg_1", role: "assistant", content: [] },
      }),
      state,
    );
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Done" },
      }),
      state,
    );
    mapClaudeSdkMessage(streamEvent({ type: "content_block_stop", index: 0 }), state);
    mapClaudeSdkMessage(
      streamEvent({
        type: "message_start",
        message: { id: "msg_1", role: "assistant", content: [] },
      }),
      state,
    );

    const snapshot = mapClaudeSdkMessage(
      {
        type: "assistant",
        session_id: "claude-session",
        message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "Done" }] },
      } as unknown as SDKMessage,
      state,
    );

    expect(snapshot).toEqual([]);
  });

  it("ignores a repeat content_block_start at the same index after the block already completed", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      state,
    );
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Good idea" },
      }),
      state,
    );
    mapClaudeSdkMessage(streamEvent({ type: "content_block_stop", index: 0 }), state);

    // SDK redelivers the same block (e.g. retry / replay). Without the
    // dedup, ensureTextItem would create a second assistant_message item
    // with duplicate content.
    const replayStart = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      state,
    );
    const replayDelta = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Good idea" },
      }),
      state,
    );

    expect(replayStart).toEqual([]);
    expect(replayDelta).toEqual([]);
  });

  it("starts a fresh per-index frame when message_start arrives between assistant messages", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "First" },
      }),
      state,
    );
    mapClaudeSdkMessage(streamEvent({ type: "content_block_stop", index: 0 }), state);

    // A new assistant message begins. The next content_block at index 0
    // must produce a NEW assistant_message item — not be skipped as a
    // duplicate of the prior message's idx 0.
    const reset = mapClaudeSdkMessage(
      streamEvent({
        type: "message_start",
        message: { id: "msg_2", role: "assistant", content: [] },
      }),
      state,
    );
    const second = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Second" },
      }),
      state,
    );

    expect(reset).toEqual([]);
    expect(second).toHaveLength(2);
    expect(second[0]).toMatchObject({ type: "item.started", itemType: "assistant_message" });
    expect(second[1]).toMatchObject({
      type: "content.delta",
      stream: "assistant_text",
      delta: "Second",
    });
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

  it("maps Edit tool results as ACP-shaped file changes", () => {
    const state = createClaudeMapperState("thread-1");
    const args = {
      file_path: "src/renderer/components/composer/MentionInput.tsx",
      old_string: "const oldValue = true;",
      new_string: "const oldValue = false;",
    };

    const started = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_edit",
          name: "Edit",
          input: args,
        },
      }),
      state,
    );

    expect(started).toEqual([
      {
        type: "item.started",
        threadId: "thread-1",
        itemId: "toolu_edit",
        itemType: "file_change",
        payload: {
          name: "Edit",
          path: "src/renderer/components/composer/MentionInput.tsx",
          changeKind: "edit",
          args,
        },
      },
    ]);

    const result = { type: "tool_result", tool_use_id: "toolu_edit", content: "Edit applied." };
    const completed = mapClaudeSdkMessage(
      {
        type: "user",
        session_id: "claude-session",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [result],
        },
      } as unknown as SDKMessage,
      state,
    );

    expect(completed).toEqual([
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "toolu_edit",
        stream: "file_change_output",
        delta: "Edit applied.",
      },
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "toolu_edit",
        payload: {
          name: "Edit",
          path: "src/renderer/components/composer/MentionInput.tsx",
          changeKind: "edit",
          args,
          result,
        },
      },
      { type: "item.completed", threadId: "thread-1", itemId: "toolu_edit" },
    ]);
  });

  it("surfaces auto-denied tool calls as completed error items", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_bash",
          name: "Bash",
          input: { command: "rm -rf /" },
        },
      }),
      state,
    );

    const events = mapClaudeSdkMessage(
      {
        type: "system",
        subtype: "permission_denied",
        tool_name: "Bash",
        tool_use_id: "toolu_bash",
        decision_reason_type: "classifier",
        decision_reason: "Dangerous command",
        message: "Command was denied.",
        session_id: "claude-session",
        uuid: "msg-1",
      } as unknown as SDKMessage,
      state,
    );

    expect(events).toEqual([
      {
        type: "content.delta",
        threadId: "thread-1",
        itemId: "toolu_bash",
        stream: "command_output",
        delta: "Command was denied.",
      },
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "toolu_bash",
        payload: {
          command: "rm -rf /",
          status: "error",
          errorMessage: "Command was denied.",
          result: {
            message: "Command was denied.",
            decisionReason: "Dangerous command",
            decisionReasonType: "classifier",
          },
        },
      },
      { type: "item.completed", threadId: "thread-1", itemId: "toolu_bash" },
    ]);
  });
});

describe("sdkCanonicalMapping — sub-agents", () => {
  it("tags item.started events with parentItemId when parent_tool_use_id is set", () => {
    const state = createClaudeMapperState("thread-1");
    const events = mapClaudeSdkMessage(
      streamEventWithParent(
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        "toolu_parent",
      ),
      state,
    );
    expect(events).toEqual([
      {
        type: "item.started",
        threadId: "thread-1",
        itemId: expect.stringMatching(/^asst-/),
        itemType: "assistant_message",
        parentItemId: "toolu_parent",
      },
    ]);
  });

  it("does not set parentItemId on top-level messages (parent_tool_use_id null)", () => {
    const state = createClaudeMapperState("thread-1");
    const events = mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      state,
    );
    expect(events[0]).not.toHaveProperty("parentItemId");
  });

  it("maps forwarded assistant tool_use blocks as subagent children", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_parent",
          name: "Task",
          input: { description: "Investigate", subagent_type: "Explore" },
        },
      }),
      state,
    );

    const events = mapClaudeSdkMessage(
      {
        type: "assistant",
        session_id: "claude-session",
        uuid: "msg-subagent-tool",
        parent_tool_use_id: "toolu_parent",
        message: {
          id: "msg-subagent-tool",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_read",
              name: "Read",
              input: { file_path: "src/App.tsx" },
            },
          ],
        },
      } as unknown as SDKMessage,
      state,
    );

    expect(events).toMatchObject([
      {
        type: "item.started",
        threadId: "thread-1",
        itemId: "toolu_read",
        itemType: "tool_call",
        parentItemId: "toolu_parent",
        payload: {
          name: "Read",
          args: { file_path: "src/App.tsx" },
          status: "running",
        },
      },
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "toolu_parent",
        payload: {
          name: "Task",
          status: "running",
          progress: { stepCount: 1 },
        },
      },
    ]);
  });
});

describe("sdkCanonicalMapping — task progress", () => {
  it("absorbs task_progress into the parent Task tool_call as item.updated", () => {
    const state = createClaudeMapperState("thread-1");
    mapClaudeSdkMessage(
      streamEvent({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_T1",
          name: "Task",
          input: { description: "research" },
        },
      }),
      state,
    );

    const events = mapClaudeSdkMessage(
      {
        type: "system",
        subtype: "task_progress",
        session_id: "claude-session",
        task_id: "task-1",
        tool_use_id: "toolu_T1",
        description: "Searching for callers",
        last_tool_name: "Grep",
        usage: { total_tokens: 4200, tool_uses: 3, duration_ms: 1500 },
      } as unknown as SDKMessage,
      state,
    );

    expect(events).toMatchObject([
      {
        type: "item.updated",
        threadId: "thread-1",
        itemId: "toolu_T1",
        payload: {
          name: "Task",
          status: "running",
          progress: {
            description: "Searching for callers",
            lastToolName: "Grep",
            tokens: 4200,
            toolUses: 3,
            durationMs: 1500,
            stepCount: 3,
          },
        },
      },
    ]);
  });

  it("ignores task_progress for unknown tool_use_id", () => {
    const state = createClaudeMapperState("thread-1");
    const events = mapClaudeSdkMessage(
      {
        type: "system",
        subtype: "task_progress",
        session_id: "claude-session",
        task_id: "task-1",
        tool_use_id: "toolu_unknown",
        description: "x",
        usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
      } as unknown as SDKMessage,
      state,
    );
    expect(events).toEqual([]);
  });
});

describe("sdkCanonicalMapping — context usage", () => {
  it("maps result usage into context usage", () => {
    const state = createClaudeMapperState("thread-1");
    const events = mapClaudeSdkMessage(
      {
        type: "result",
        subtype: "success",
        session_id: "claude-session",
        usage: {
          input_tokens: 60_000,
          output_tokens: 8_000,
          cache_read_input_tokens: 1_000,
          cache_creation_input_tokens: 500,
          total_tokens: 69_500,
        },
      } as unknown as SDKMessage,
      state,
    );

    expect(events[0]).toEqual({
      type: "context.updated",
      threadId: "thread-1",
      usage: {
        usedTokens: 69_500,
        breakdown: [
          { id: "input", label: "Input", tokens: 60_000 },
          { id: "output", label: "Output", tokens: 8_000 },
          { id: "cache-read", label: "Cache read", tokens: 1_000 },
          { id: "cache-write", label: "Cache write", tokens: 500 },
        ],
      },
    });
  });
});

describe("sdkCanonicalMapping — compaction", () => {
  it("starts a running ContextCompaction tool_call for a manual /compact turn", () => {
    const state = createClaudeMapperState("thread-1");
    const events = startClaudeTurn(state, "turn-compact", "/compact", undefined, "user-compact");

    expect(events).toContainEqual({
      type: "item.started",
      threadId: "thread-1",
      itemId: "compact-turn-compact",
      itemType: "tool_call",
      payload: {
        name: "ContextCompaction",
        status: "running",
        args: { trigger: "manual" },
      },
    });
  });

  it("completes the running manual ContextCompaction tool_call when boundary arrives", () => {
    const state = createClaudeMapperState("thread-1");
    startClaudeTurn(state, "turn-compact", "/compact keep recent work", undefined, "user-compact");

    const events = mapClaudeSdkMessage(
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "manual", pre_tokens: 290000, post_tokens: 9900 },
        session_id: "claude-session",
      } as unknown as SDKMessage,
      state,
    );

    expect(events).toEqual([
      {
        type: "item.completed",
        threadId: "thread-1",
        itemId: "compact-turn-compact",
        payload: {
          name: "ContextCompaction",
          status: "success",
          args: { trigger: "manual", pre_tokens: 290000, post_tokens: 9900 },
        },
      },
    ]);
  });

  it("synthesizes a ContextCompaction tool_call carrying compact_metadata when boundary arrives", () => {
    const state = createClaudeMapperState("thread-1");
    const events = mapClaudeSdkMessage(
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 100000, post_tokens: 12000 },
        session_id: "claude-session",
      } as unknown as SDKMessage,
      state,
    );
    expect(events).toMatchObject([
      {
        type: "item.started",
        itemType: "tool_call",
        payload: {
          name: "ContextCompaction",
          status: "success",
          args: { trigger: "auto", pre_tokens: 100000, post_tokens: 12000 },
        },
      },
      {
        type: "item.completed",
        payload: {
          name: "ContextCompaction",
          status: "success",
          args: { trigger: "auto", pre_tokens: 100000, post_tokens: 12000 },
        },
      },
    ]);
    expect((events[0] as { itemId: string }).itemId).toBe((events[1] as { itemId: string }).itemId);
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

  it("forwards displayName, blockedPath, decisionReason, and toolUseID into details", () => {
    const event = mapClaudePermissionRequest({
      threadId: "thread-1",
      requestId: "perm-2",
      toolName: "Read",
      toolInput: { file_path: "/tmp/x.txt" },
      displayName: "Read",
      description: "/tmp/x.txt",
      blockedPath: "/tmp",
      decisionReason: "Path is outside allowed working directories",
      toolUseID: "toolu_01",
    });
    expect(event).toMatchObject({
      type: "request.opened",
      payload: {
        details: {
          toolName: "Read",
          displayName: "Read",
          description: "/tmp/x.txt",
          blockedPath: "/tmp",
          decisionReason: "Path is outside allowed working directories",
          toolUseID: "toolu_01",
          input: { file_path: "/tmp/x.txt" },
        },
      },
    });
  });

  it("translates suggestions into one option per suggestion plus accept/decline", () => {
    const event = mapClaudePermissionRequest({
      threadId: "thread-1",
      requestId: "perm-3",
      toolName: "Bash",
      toolInput: { command: "ls /tmp" },
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "ls /tmp" }],
          behavior: "allow",
          destination: "localSettings",
        },
        {
          type: "addDirectories",
          directories: ["/tmp"],
          destination: "session",
        },
      ],
    });
    expect(event).toMatchObject({
      type: "request.opened",
      payload: {
        options: [
          { optionId: "accept", label: "Allow once" },
          {
            optionId: "accept-suggestion-0",
            label: "Always allow Bash (local)",
            description: "ls /tmp",
          },
          { optionId: "accept-suggestion-1", label: "Allow directories /tmp" },
          { optionId: "decline", label: "Deny" },
        ],
      },
    });
  });

  it("falls back to a single Always-allow option when no suggestions are present", () => {
    const event = mapClaudePermissionRequest({
      threadId: "thread-1",
      requestId: "perm-4",
      toolName: "Bash",
      toolInput: { command: "echo hi" },
    });
    expect(event).toMatchObject({
      payload: {
        options: [
          { optionId: "accept", label: "Allow once" },
          { optionId: "acceptForSession", label: "Always allow" },
          { optionId: "decline", label: "Deny" },
        ],
      },
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
