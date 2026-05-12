import { describe, expect, it } from "vitest";
import { createCodexMapperState, mapCodexNotification } from "./canonicalMapping";

describe("mapCodexNotification — turn lifecycle", () => {
  it("emits turn.started with the supplied turnId", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification("turn/started", { turnId: "abc", threadId: "x" }, state);
    expect(events).toEqual([{ type: "turn.started", threadId: "t-codex", turnId: "abc" }]);
    expect(state.currentTurnId).toBe("abc");
  });

  it("emits turn.started with the real app-server nested turn id", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "turn/started",
      { threadId: "x", turn: { id: "turn-real", status: "inProgress" } },
      state,
    );
    expect(events).toEqual([{ type: "turn.started", threadId: "t-codex", turnId: "turn-real" }]);
    expect(state.currentTurnId).toBe("turn-real");
  });

  it("closes any open assistant item when a turn completes", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification("turn/started", { turnId: "t-1", threadId: "x" }, state);
    mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        turnId: "t-1",
        itemId: "msg-1",
        item: { id: "msg-1", type: "agentMessage" },
      },
      state,
    );
    expect(state.openAssistantItemId).toBeDefined();

    const events = mapCodexNotification("turn/completed", { threadId: "x" }, state);
    expect(events.map((e) => e.type)).toEqual(["item.completed", "turn.completed"]);
    expect(state.openAssistantItemId).toBeUndefined();
    expect(state.currentTurnId).toBeUndefined();
  });

  it("treats turn/aborted as turn.completed with state=interrupted", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification("turn/started", { turnId: "t-1", threadId: "x" }, state);
    const events = mapCodexNotification("turn/aborted", { threadId: "x" }, state);
    const completed = events.find((e) => e.type === "turn.completed");
    expect(completed).toMatchObject({ type: "turn.completed", state: "interrupted" });
  });

  it("treats turn/completed with interrupted status as state=interrupted", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification("turn/started", { turnId: "t-1", threadId: "x" }, state);
    const events = mapCodexNotification(
      "turn/completed",
      { threadId: "x", turn: { id: "t-1", status: "interrupted" } },
      state,
    );
    const completed = events.find((e) => e.type === "turn.completed");
    expect(completed).toMatchObject({ type: "turn.completed", state: "interrupted" });
  });

  it("maps turn usage into context usage when the app-server provides it", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification("turn/started", { turnId: "t-1", threadId: "x" }, state);
    const events = mapCodexNotification(
      "turn/completed",
      {
        threadId: "x",
        turn: { id: "t-1", usage: { input_tokens: 10_000, output_tokens: 2_000, size: 200_000 } },
      },
      state,
    );

    expect(events[0]).toEqual({
      type: "context.updated",
      threadId: "t-codex",
      usage: {
        usedTokens: 12_000,
        maxTokens: 200_000,
        breakdown: [
          { id: "input", label: "Input", tokens: 10_000 },
          { id: "output", label: "Output", tokens: 2_000 },
        ],
      },
    });
  });

  it("maps Codex token usage notifications into context usage", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "thread/tokenUsage/updated",
      {
        threadId: "x",
        info: {
          last_token_usage: {
            input_tokens: 19_250,
            cached_input_tokens: 2_432,
            output_tokens: 85,
            reasoning_output_tokens: 74,
            total_tokens: 19_335,
          },
          model_context_window: 258_400,
        },
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "context.updated",
        threadId: "t-codex",
        usage: {
          usedTokens: 19_335,
          maxTokens: 258_400,
          breakdown: [
            { id: "input", label: "Input", tokens: 19_250 },
            { id: "output", label: "Output", tokens: 85 },
            { id: "reasoning", label: "Reasoning", tokens: 74 },
            { id: "cache-read", label: "Cache read", tokens: 2_432 },
          ],
        },
      },
    ]);
  });

  it("maps current Codex tokenUsage notifications into context usage", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "thread/tokenUsage/updated",
      {
        threadId: "x",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            inputTokens: 11_833,
            cachedInputTokens: 3456,
            outputTokens: 6,
            reasoningOutputTokens: 0,
            totalTokens: 11_839,
          },
          last: {
            inputTokens: 120,
            cachedInputTokens: 0,
            outputTokens: 6,
            reasoningOutputTokens: 4,
            totalTokens: 130,
          },
          modelContextWindow: 258_400,
        },
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "context.updated",
        threadId: "t-codex",
        usage: {
          usedTokens: 130,
          maxTokens: 258_400,
          breakdown: [
            { id: "input", label: "Input", tokens: 120 },
            { id: "output", label: "Output", tokens: 6 },
            { id: "reasoning", label: "Reasoning", tokens: 4 },
          ],
        },
      },
    ]);
  });
});

describe("mapCodexNotification — goals", () => {
  it("maps Codex thread goal updates to a shared goal chat item", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "thread/goal/updated",
      {
        threadId: "provider-thread",
        turnId: "turn-1",
        goal: {
          threadId: "provider-thread",
          objective: "ship unified GUI goal support",
          status: "active",
          tokenBudget: 5000,
          tokensUsed: 120,
          timeUsedSeconds: 3,
          createdAt: 1778570000,
          updatedAt: 1778570003,
        },
      },
      state,
    );

    expect(events).toEqual([
      {
        type: "item.started",
        threadId: "t-codex",
        itemId: expect.stringMatching(/^goal-/u),
        itemType: "goal",
        payload: {
          action: "set",
          objective: "ship unified GUI goal support",
          status: "active",
          tokenBudget: 5000,
          tokensUsed: 120,
          timeUsedSeconds: 3,
          providerThreadId: "provider-thread",
          updatedAt: 1778570003,
        },
      },
      {
        type: "item.completed",
        threadId: "t-codex",
        itemId: events[0]?.type === "item.started" ? events[0].itemId : "",
      },
    ]);
  });

  it("updates the existing Codex goal item when the goal is cleared", () => {
    const state = createCodexMapperState("t-codex");
    const started = mapCodexNotification(
      "thread/goal/updated",
      {
        threadId: "provider-thread",
        goal: {
          threadId: "provider-thread",
          objective: "ship unified GUI goal support",
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1778570000,
          updatedAt: 1778570000,
        },
      },
      state,
    );
    const goalItemId = started[0]?.type === "item.started" ? started[0].itemId : "";

    const cleared = mapCodexNotification(
      "thread/goal/cleared",
      { threadId: "provider-thread" },
      state,
    );

    expect(cleared).toEqual([
      {
        type: "item.updated",
        threadId: "t-codex",
        itemId: goalItemId,
        payload: {
          action: "cleared",
          providerThreadId: "provider-thread",
        },
      },
      { type: "item.completed", threadId: "t-codex", itemId: goalItemId },
    ]);
  });
});

describe("mapCodexNotification — item lifecycle (item/started, item/completed)", () => {
  it("ignores Codex user_message item/started (user bubble comes from CodexStructuredSession.startTurn)", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "u-1",
        item: { id: "u-1", type: "userMessage", text: "hello" },
      },
      state,
    );
    expect(events).toEqual([]);
    expect(state.itemIdMap.size).toBe(0);
  });

  it("opens an assistant item on item/started with type=agentMessage", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "item/started",
      { threadId: "x", itemId: "msg-1", item: { id: "msg-1", type: "agentMessage" } },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("item.started");
    expect((events[0] as { itemType: string }).itemType).toBe("assistant_message");
    expect(state.openAssistantItemId).toBeDefined();
  });

  it("classifies known kinds correctly via toCanonicalItemType", () => {
    const state = createCodexMapperState("t-codex");
    const exec = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "i-1",
        item: { id: "i-1", type: "commandExecution", command: "ls" },
      },
      state,
    );
    expect((exec[0] as { itemType: string }).itemType).toBe("command_execution");

    const patch = mapCodexNotification(
      "item/started",
      { threadId: "x", itemId: "i-2", item: { id: "i-2", type: "fileChange", path: "src/foo.ts" } },
      state,
    );
    expect((patch[0] as { itemType: string }).itemType).toBe("file_change");

    const search = mapCodexNotification(
      "item/started",
      { threadId: "x", itemId: "i-3", item: { id: "i-3", type: "webSearch", query: "tokio" } },
      state,
    );
    expect((search[0] as { itemType: string }).itemType).toBe("web_search");

    const reasoning = mapCodexNotification(
      "item/started",
      { threadId: "x", itemId: "i-4", item: { id: "i-4", type: "reasoning" } },
      state,
    );
    expect((reasoning[0] as { itemType: string }).itemType).toBe("reasoning");
  });

  it("captures tool_call args at start and result at completion (parity with ACP)", () => {
    const state = createCodexMapperState("t-codex");
    const started = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "tool-1",
        item: {
          id: "tool-1",
          type: "mcp",
          title: "github-search",
          input: { query: "tokio", page: 1 },
        },
      },
      state,
    );
    const startedPayload = (started[0] as { payload: Record<string, unknown> }).payload;
    expect(startedPayload).toMatchObject({
      name: "github-search",
      args: { query: "tokio", page: 1 },
      status: "running",
    });

    const completed = mapCodexNotification(
      "item/completed",
      {
        threadId: "x",
        itemId: "tool-1",
        item: { id: "tool-1", status: "completed", output: { hits: 3 } },
      },
      state,
    );
    const completedPayload = (completed.at(-1) as { payload: Record<string, unknown> }).payload;
    expect(completedPayload).toMatchObject({ status: "success", result: { hits: 3 } });
  });

  it("classifies file_change kind from item.changeKind / kind / type", () => {
    const state = createCodexMapperState("t-codex");
    const create = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-1",
        item: { id: "fc-1", type: "fileChange", path: "src/foo.ts", changeKind: "create" },
      },
      state,
    );
    expect((create[0] as { payload: Record<string, unknown> }).payload).toMatchObject({
      path: "src/foo.ts",
      changeKind: "create",
    });

    const del = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-2",
        item: { id: "fc-2", type: "fileChange", path: "old.ts", kind: "delete" },
      },
      state,
    );
    expect((del[0] as { payload: Record<string, unknown> }).payload.changeKind).toBe("delete");

    const edit = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-3",
        item: { id: "fc-3", type: "fileChange", path: "x.ts" },
      },
      state,
    );
    expect((edit[0] as { payload: Record<string, unknown> }).payload.changeKind).toBe("edit");
  });

  it("extracts file_change path from apply_patch text args", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-patch",
        item: {
          id: "fc-patch",
          type: "fileChange",
          args: "*** Begin Patch\n*** Update File: src/foo.ts\n@@\n-old\n+new\n*** End Patch",
        },
      },
      state,
    );
    expect((events[0] as { payload: Record<string, unknown> }).payload.path).toBe("src/foo.ts");
  });

  it("extracts file_change path from edit tool file_path args", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-edit",
        item: {
          id: "fc-edit",
          type: "fileChange",
          args: { file_path: "src/supervisor/agents/codex/canonicalMapping.ts" },
        },
      },
      state,
    );
    expect((events[0] as { payload: Record<string, unknown> }).payload.path).toBe(
      "src/supervisor/agents/codex/canonicalMapping.ts",
    );
  });

  it("extracts file_change metadata from real Codex app-server changes arrays", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-changes",
        item: {
          id: "fc-changes",
          type: "fileChange",
          changes: [
            {
              path: "/tmp/lightcode-codex-probe/probe.txt",
              kind: { type: "update", move_path: null },
              diff: "@@ -1 +1 @@\n-before\n+after\n",
            },
          ],
          status: "inProgress",
        },
      },
      state,
    );

    expect((events[0] as { payload: Record<string, unknown> }).payload).toMatchObject({
      path: "/tmp/lightcode-codex-probe/probe.txt",
      changeKind: "edit",
      diffSummary: { added: 1, removed: 1 },
      args: {
        changes: [
          {
            path: "/tmp/lightcode-codex-probe/probe.txt",
            kind: { type: "update", move_path: null },
            diff: "@@ -1 +1 @@\n-before\n+after\n",
          },
        ],
      },
    });
  });

  it("extracts file_change path from Codex title/name fallbacks", () => {
    const state = createCodexMapperState("t-codex");
    const titleEvents = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-title",
        item: {
          id: "fc-title",
          type: "fileChange",
          title: "src/renderer/App.tsx: render => render",
        },
      },
      state,
    );
    expect((titleEvents[0] as { payload: Record<string, unknown> }).payload.path).toBe(
      "src/renderer/App.tsx",
    );

    const nameEvents = mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "fc-name",
        item: {
          id: "fc-name",
          type: "fileChange",
          name: "Writing to src/supervisor/agents/codex/canonicalMapping.ts",
        },
      },
      state,
    );
    expect((nameEvents[0] as { payload: Record<string, unknown> }).payload.path).toBe(
      "src/supervisor/agents/codex/canonicalMapping.ts",
    );
  });

  it("updates file_change path from streamed output", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      { threadId: "x", itemId: "fc-output", item: { id: "fc-output", type: "fileChange" } },
      state,
    );

    const events = mapCodexNotification(
      "item/fileChange/outputDelta",
      {
        threadId: "x",
        itemId: "fc-output",
        delta:
          "Success. Updated the following files:\nM\nC:\\Users\\sdsle\\work\\lightcode\\src\\foo.ts",
      },
      state,
    );

    expect(events[0]).toMatchObject({
      type: "item.updated",
      payload: { path: "C:\\Users\\sdsle\\work\\lightcode\\src\\foo.ts" },
    });
    expect(events[1]).toMatchObject({
      type: "content.delta",
      stream: "file_change_output",
    });
  });

  it("captures web_search resultCount + name on completion", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "ws-1",
        item: { id: "ws-1", type: "webSearch", query: "rust async", title: "browser_search" },
      },
      state,
    );
    const completed = mapCodexNotification(
      "item/completed",
      {
        threadId: "x",
        itemId: "ws-1",
        item: { id: "ws-1", status: "completed", results: [{ url: "a" }, { url: "b" }] },
      },
      state,
    );
    const payload = (completed.at(-1) as { payload: Record<string, unknown> }).payload;
    expect(payload).toMatchObject({ status: "success", resultCount: 2 });
  });

  it("emits item.completed with status / exitCode / durationMs for commandExecution", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "cmd-1",
        item: { id: "cmd-1", type: "commandExecution", command: "echo" },
      },
      state,
    );
    const events = mapCodexNotification(
      "item/completed",
      {
        threadId: "x",
        itemId: "cmd-1",
        item: { id: "cmd-1", status: "completed", exitCode: 0, durationMs: 42 },
      },
      state,
    );
    expect(events.at(-1)?.type).toBe("item.completed");
    expect((events.at(-1) as { payload: Record<string, unknown> }).payload).toMatchObject({
      status: "success",
      exitCode: 0,
      durationMs: 42,
    });
  });

  it("emits completed command aggregatedOutput when no output delta was observed", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "cmd-agg",
        item: { id: "cmd-agg", type: "commandExecution", command: "pwd" },
      },
      state,
    );

    const events = mapCodexNotification(
      "item/completed",
      {
        threadId: "x",
        itemId: "cmd-agg",
        item: {
          id: "cmd-agg",
          type: "commandExecution",
          status: "completed",
          aggregatedOutput: "/tmp/project\n",
          exitCode: 0,
        },
      },
      state,
    );

    expect(events.map((event) => event.type)).toEqual(["content.delta", "item.completed"]);
    expect(events[0]).toMatchObject({
      type: "content.delta",
      stream: "command_output",
      delta: "/tmp/project\n",
    });
  });

  it("does not duplicate completed command aggregatedOutput after output deltas", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "cmd-streamed",
        item: { id: "cmd-streamed", type: "commandExecution", command: "pwd" },
      },
      state,
    );
    mapCodexNotification(
      "item/commandExecution/outputDelta",
      {
        threadId: "x",
        itemId: "cmd-streamed",
        delta: "/tmp/project\n",
      },
      state,
    );

    const events = mapCodexNotification(
      "item/completed",
      {
        threadId: "x",
        itemId: "cmd-streamed",
        item: {
          id: "cmd-streamed",
          type: "commandExecution",
          status: "completed",
          aggregatedOutput: "/tmp/project\n",
          exitCode: 0,
        },
      },
      state,
    );

    expect(events.map((event) => event.type)).toEqual(["item.completed"]);
  });

  it("synthesises started+completed when only item/completed is observed", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "item/completed",
      {
        threadId: "x",
        itemId: "msg-1",
        item: { id: "msg-1", type: "agentMessage", text: "hello" },
      },
      state,
    );
    expect(events.map((e) => e.type)).toEqual(["item.started", "content.delta", "item.completed"]);
  });
});

describe("mapCodexNotification — streaming deltas", () => {
  it("routes item/agentMessage/delta to the assistant_text stream", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      { threadId: "x", itemId: "msg-1", item: { id: "msg-1", type: "agentMessage" } },
      state,
    );
    const events = mapCodexNotification(
      "item/agentMessage/delta",
      { threadId: "x", itemId: "msg-1", delta: "Hello" },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "content.delta",
      stream: "assistant_text",
      delta: "Hello",
    });
  });

  it("routes item/commandExecution/outputDelta to the command_output stream", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      {
        threadId: "x",
        itemId: "cmd-1",
        item: { id: "cmd-1", type: "commandExecution", command: "ls" },
      },
      state,
    );
    const events = mapCodexNotification(
      "item/commandExecution/outputDelta",
      { threadId: "x", itemId: "cmd-1", delta: "file.txt\n" },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "content.delta",
      stream: "command_output",
      delta: "file.txt\n",
    });
  });

  it("routes item/reasoning/textDelta and summaryTextDelta to reasoning_text", () => {
    const state = createCodexMapperState("t-codex");
    mapCodexNotification(
      "item/started",
      { threadId: "x", itemId: "rs-1", item: { id: "rs-1", type: "reasoning" } },
      state,
    );
    const text = mapCodexNotification(
      "item/reasoning/textDelta",
      { threadId: "x", itemId: "rs-1", delta: "thinking" },
      state,
    );
    expect(text[0]).toMatchObject({ type: "content.delta", stream: "reasoning_text" });
    const summary = mapCodexNotification(
      "item/reasoning/summaryTextDelta",
      { threadId: "x", itemId: "rs-1", delta: "summary" },
      state,
    );
    expect(summary[0]).toMatchObject({ type: "content.delta", stream: "reasoning_text" });
  });

  it("auto-opens an item when delta arrives before item/started", () => {
    const state = createCodexMapperState("t-codex");
    const events = mapCodexNotification(
      "item/agentMessage/delta",
      { threadId: "x", itemId: "msg-2", delta: "boom" },
      state,
    );
    expect(events.map((e) => e.type)).toEqual(["item.started", "content.delta"]);
  });

  it("returns [] for unknown methods", () => {
    const state = createCodexMapperState("t-codex");
    expect(mapCodexNotification("totally/unknown", {}, state)).toEqual([]);
  });
});
