import { describe, expect, it } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { closeOpenItems, createOpenCodeMapperState, mapOpenCodeEvent } from "./sdkCanonicalMapping";

function deltaEvent(messageID: string, partID: string, delta: string): Event {
  return {
    id: "evt-" + Math.random().toString(36).slice(2),
    type: "message.part.delta",
    properties: {
      sessionID: "ses_test",
      messageID,
      partID,
      field: "text",
      delta,
    },
  };
}

function partUpdatedTextEvent(messageID: string, partID: string, text: string): Event {
  return {
    id: "evt-" + Math.random().toString(36).slice(2),
    type: "message.part.updated",
    properties: {
      sessionID: "ses_test",
      time: Date.now(),
      part: {
        id: partID,
        sessionID: "ses_test",
        messageID,
        type: "text",
        text,
      },
    },
  };
}

describe("sdkCanonicalMapping — text streaming", () => {
  it("opens an assistant item on the first delta and emits content.delta", () => {
    const state = createOpenCodeMapperState("thread-1");
    const events = mapOpenCodeEvent(deltaEvent("msg_1", "prt_1", "Hello"), state);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "item.started",
      threadId: "thread-1",
      itemType: "assistant_message",
    });
    expect(events[1]).toMatchObject({
      type: "content.delta",
      threadId: "thread-1",
      stream: "assistant_text",
      delta: "Hello",
    });
  });

  it("appends subsequent deltas to the same assistant item", () => {
    const state = createOpenCodeMapperState("thread-1");
    mapOpenCodeEvent(deltaEvent("msg_1", "prt_1", "Hel"), state);
    const second = mapOpenCodeEvent(deltaEvent("msg_1", "prt_1", "lo"), state);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      type: "content.delta",
      delta: "lo",
    });
  });

  it("dedupes interleaved snapshot using suffixPrefixOverlap", () => {
    const state = createOpenCodeMapperState("thread-1");
    // Stream "Hello " via deltas.
    mapOpenCodeEvent(deltaEvent("msg_1", "prt_1", "Hel"), state);
    mapOpenCodeEvent(deltaEvent("msg_1", "prt_1", "lo "), state);

    // Snapshot arrives with the full text so far. Should NOT re-emit "Hello ".
    const snap = mapOpenCodeEvent(partUpdatedTextEvent("msg_1", "prt_1", "Hello "), state);
    expect(snap).toEqual([]);

    // Snapshot extends to "Hello world" — emit only " world" as the new tail.
    const ext = mapOpenCodeEvent(partUpdatedTextEvent("msg_1", "prt_1", "Hello world"), state);
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({
      type: "content.delta",
      delta: "world",
    });
  });

  it("treats parts on different message ids as different assistant items", () => {
    const state = createOpenCodeMapperState("thread-1");
    const a = mapOpenCodeEvent(deltaEvent("msg_a", "prt_1", "A"), state);
    const b = mapOpenCodeEvent(deltaEvent("msg_b", "prt_1", "B"), state);
    const aItemId = a.find((e) => e.type === "item.started")?.itemId;
    const bItemId = b.find((e) => e.type === "item.started")?.itemId;
    expect(aItemId).toBeDefined();
    expect(bItemId).toBeDefined();
    expect(aItemId).not.toBe(bItemId);
  });
});

describe("sdkCanonicalMapping — permission/question events", () => {
  it("maps permission.asked → request.opened with command_execution_approval", () => {
    const state = createOpenCodeMapperState("thread-1");
    const events = mapOpenCodeEvent(
      {
        id: "evt-x",
        type: "permission.asked",
        properties: {
          id: "perm_1",
          sessionID: "ses_test",
          permission: "bash",
          patterns: ["rm -rf /tmp"],
          metadata: {},
          always: [],
        },
      } as Event,
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "request.opened",
      requestId: "perm_1",
      requestType: "command_execution_approval",
    });
  });

  it("maps question.asked → request.opened with multiSelect aggregation", () => {
    const state = createOpenCodeMapperState("thread-1");
    const events = mapOpenCodeEvent(
      {
        id: "evt-x",
        type: "question.asked",
        properties: {
          id: "q_1",
          sessionID: "ses_test",
          questions: [
            {
              question: "Pick frameworks",
              header: "Frameworks",
              multiple: true,
              options: [
                { label: "React", description: "UI lib" },
                { label: "Vue", description: "Reactive" },
              ],
            },
          ],
        },
      } as Event,
      state,
    );
    expect(events).toHaveLength(1);
    const ev = events[0];
    if (ev?.type !== "request.opened") throw new Error("unexpected event");
    expect(ev.requestType).toBe("tool_user_input");
    expect(ev.payload.multiSelect).toBe(true);
    expect(ev.payload.options).toHaveLength(2);
    expect(ev.payload.options?.[0]?.label).toBe("React");
  });
});

describe("sdkCanonicalMapping — todowrite → plan", () => {
  it("classifies `todowrite` as a plan item and extracts steps from input.todos", () => {
    // OpenCode's todowrite tool mirrors Claude's: `{ todos: [{ content, status,
    // priority }] }`. The mapper must surface this as a canonical `plan` item
    // so ThreadTodoDock picks it up instead of rendering a generic accordion.
    const state = createOpenCodeMapperState("thread-1");
    const events = mapOpenCodeEvent(
      {
        id: "evt-todo",
        type: "message.part.updated",
        properties: {
          sessionID: "ses_test",
          time: 0,
          part: {
            id: "prt_todo_1",
            sessionID: "ses_test",
            messageID: "msg_1",
            type: "tool",
            tool: "todowrite",
            callID: "call_todo_1",
            state: {
              status: "running",
              input: {
                todos: [
                  { content: "First task", status: "in_progress", priority: "high" },
                  { content: "Second task", status: "pending", priority: "high" },
                  { content: "Third task", status: "completed", priority: "medium" },
                ],
              },
              time: { start: 0 },
            },
          },
        },
      } as Event,
      state,
    );
    const started = events.find((e) => e.type === "item.started");
    if (started?.type !== "item.started") throw new Error("expected item.started");
    expect(started.itemType).toBe("plan");
    expect(started.payload).toEqual({
      steps: [
        { step: "First task", status: "in_progress" },
        { step: "Second task", status: "pending" },
        { step: "Third task", status: "completed" },
      ],
    });
  });

  it("treats unknown statuses as pending and falls back to 'Task' for empty content", () => {
    const state = createOpenCodeMapperState("thread-1");
    const events = mapOpenCodeEvent(
      {
        id: "evt-todo-2",
        type: "message.part.updated",
        properties: {
          sessionID: "ses_test",
          time: 0,
          part: {
            id: "prt_todo_2",
            sessionID: "ses_test",
            messageID: "msg_2",
            type: "tool",
            tool: "todowrite",
            callID: "call_todo_2",
            state: {
              status: "running",
              input: {
                todos: [
                  { content: "   ", status: "weird-unknown" },
                  { content: "Real one", status: "in_progress" },
                ],
              },
              time: { start: 0 },
            },
          },
        },
      } as Event,
      state,
    );
    const started = events.find((e) => e.type === "item.started");
    if (started?.type !== "item.started") throw new Error("expected item.started");
    expect(started.payload).toEqual({
      steps: [
        { step: "Task", status: "pending" },
        { step: "Real one", status: "in_progress" },
      ],
    });
  });
});

describe("sdkCanonicalMapping — tool parts", () => {
  it("classifies bash tool as command_execution and emits item.started", () => {
    const state = createOpenCodeMapperState("thread-1");
    const events = mapOpenCodeEvent(
      {
        id: "evt-x",
        type: "message.part.updated",
        properties: {
          sessionID: "ses_test",
          time: 0,
          part: {
            id: "prt_tool_1",
            sessionID: "ses_test",
            messageID: "msg_1",
            type: "tool",
            tool: "bash",
            callID: "call_1",
            state: {
              status: "running",
              input: { command: "ls /" },
              time: { start: 0 },
            },
          },
        },
      } as Event,
      state,
    );
    expect(events.find((e) => e.type === "item.started")).toMatchObject({
      itemType: "command_execution",
    });
  });
});

function userMessageUpdatedEvent(messageID: string): Event {
  return {
    id: "evt-" + Math.random().toString(36).slice(2),
    type: "message.updated",
    properties: {
      sessionID: "ses_test",
      info: {
        id: messageID,
        sessionID: "ses_test",
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "test" },
        time: { created: Date.now() },
        path: { cwd: "/", root: "/" },
      },
    },
  } as unknown as Event;
}

describe("sdkCanonicalMapping — user message dedup", () => {
  it("reuses the runtime's optimistic user_message id when present", () => {
    const state = createOpenCodeMapperState("thread-1");
    state.pendingUserMessageItemIds.push("user-optimistic-1");

    const events = mapOpenCodeEvent(userMessageUpdatedEvent("msg_user_1"), state);

    // Should NOT emit item.started — the runtime already painted that bubble.
    expect(events).toEqual([]);
    expect(state.userItems.get("msg_user_1")).toBe("user-optimistic-1");
    expect(state.pendingUserMessageItemIds).toHaveLength(0);
  });

  it("emits item.started when no optimistic id is queued (e.g. resume/replay)", () => {
    const state = createOpenCodeMapperState("thread-1");

    const events = mapOpenCodeEvent(userMessageUpdatedEvent("msg_user_1"), state);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "item.started", itemType: "user_message" });
  });

  it("skips text parts that belong to a known user message", () => {
    const state = createOpenCodeMapperState("thread-1");
    state.pendingUserMessageItemIds.push("user-optimistic-1");
    mapOpenCodeEvent(userMessageUpdatedEvent("msg_user_1"), state);

    const partEvents = mapOpenCodeEvent(
      partUpdatedTextEvent("msg_user_1", "prt_user_1", "what you can do?"),
      state,
    );

    // No phantom assistant_message should be created from the user's own text.
    expect(partEvents).toEqual([]);
    expect(state.assistantItems.size).toBe(0);
  });

  it("still emits assistant text for parts on assistant messages", () => {
    const state = createOpenCodeMapperState("thread-1");
    // Assistant has no message.updated yet — fall back to current behaviour.
    const events = mapOpenCodeEvent(deltaEvent("msg_asst_1", "prt_1", "Hi"), state);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "item.started", itemType: "assistant_message" });
  });
});

function reasoningPartUpdatedEvent(
  messageID: string,
  partID: string,
  text: string,
  end?: number,
): Event {
  return {
    id: "evt-" + Math.random().toString(36).slice(2),
    type: "message.part.updated",
    properties: {
      sessionID: "ses_test",
      time: Date.now(),
      part: {
        id: partID,
        sessionID: "ses_test",
        messageID,
        type: "reasoning",
        text,
        time: end !== undefined ? { start: 0, end } : { start: 0 },
      },
    },
  } as unknown as Event;
}

function assistantMessageUpdatedEvent(messageID: string, completed?: number): Event {
  return {
    id: "evt-" + Math.random().toString(36).slice(2),
    type: "message.updated",
    properties: {
      sessionID: "ses_test",
      info: {
        id: messageID,
        sessionID: "ses_test",
        role: "assistant",
        agent: "build",
        model: { providerID: "test", modelID: "test" },
        time: completed !== undefined ? { created: 0, completed } : { created: 0 },
        path: { cwd: "/", root: "/" },
      },
    },
  } as unknown as Event;
}

describe("sdkCanonicalMapping — reasoning delta routing", () => {
  it("routes field='text' deltas on a known reasoning Part to the reasoning stream", () => {
    // OpenCode emits `field: "text"` for both TextPart and ReasoningPart deltas
    // because both Parts have a `text` property. Routing by field alone would
    // leak the chain-of-thought into the assistant_message bubble. Once the
    // snapshot has registered the Part as `reasoning`, deltas for that partID
    // must follow.
    const state = createOpenCodeMapperState("thread-1");
    // Snapshot first — registers the part as type=reasoning.
    mapOpenCodeEvent(reasoningPartUpdatedEvent("msg_a", "prt_r", ""), state);

    const events = mapOpenCodeEvent(deltaEvent("msg_a", "prt_r", "thinking..."), state);

    // Should NOT have created an assistant_message item.
    expect(
      events.find((e) => e.type === "item.started" && e.itemType === "assistant_message"),
    ).toBeUndefined();
    // Should have streamed into reasoning_text.
    const delta = events.find((e) => e.type === "content.delta");
    expect(delta).toMatchObject({ stream: "reasoning_text", delta: "thinking..." });
  });
});

describe("sdkCanonicalMapping — reasoning completion", () => {
  it("emits item.completed for the reasoning item when the part snapshot has time.end", () => {
    const state = createOpenCodeMapperState("thread-1");
    // Open a reasoning item via a streaming snapshot.
    mapOpenCodeEvent(reasoningPartUpdatedEvent("msg_a", "prt_r", "thinking..."), state);

    // Final snapshot arrives with time.end set.
    const closing = mapOpenCodeEvent(
      reasoningPartUpdatedEvent("msg_a", "prt_r", "thinking... done", 100),
      state,
    );

    expect(closing.find((e) => e.type === "item.completed")).toBeDefined();
  });

  it("closes any open reasoning items when the parent assistant message completes", () => {
    const state = createOpenCodeMapperState("thread-1");
    mapOpenCodeEvent(reasoningPartUpdatedEvent("msg_a", "prt_r", "thinking..."), state);
    // Reasoning never received time.end — assistant message wraps up anyway.
    const events = mapOpenCodeEvent(assistantMessageUpdatedEvent("msg_a", 200), state);

    const completes = events.filter((e) => e.type === "item.completed");
    expect(completes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("sdkCanonicalMapping — closeOpenItems", () => {
  it("emits item.completed for every open assistant/reasoning/tool item", () => {
    const state = createOpenCodeMapperState("thread-1");
    mapOpenCodeEvent(deltaEvent("msg_1", "prt_1", "hi"), state);
    const closed = closeOpenItems(state);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ type: "item.completed", threadId: "thread-1" });
  });
});
