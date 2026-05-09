import { describe, expect, it } from "vitest";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import {
  closeOpenTurnItems,
  createAcpMapperState,
  mapAcpSessionUpdate,
} from "./canonicalMapping";

/**
 * Smoke tests for the generic ACP → canonical RuntimeEvent mapper.
 *
 * These cover the high-value translation paths exercised by every ACP-speaking
 * adapter (Copilot today; user-registered acp-generic instances and Zed's
 * codex-acp shim by extension).
 */

function note(update: SessionNotification["update"]): SessionNotification {
  return { sessionId: "s1", update };
}

describe("mapAcpSessionUpdate", () => {
  it("opens an assistant_message on first agent_message_chunk and streams deltas", () => {
    const state = createAcpMapperState("t-1");

    const first = mapAcpSessionUpdate(
      note({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } }),
      state,
    );
    const second = mapAcpSessionUpdate(
      note({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " world" } }),
      state,
    );

    // First chunk → item.started + content.delta on a fresh assistant id.
    expect(first.map((e) => e.type)).toEqual(["item.started", "content.delta"]);
    expect(state.openAssistantItemId).toBeDefined();
    const itemId = state.openAssistantItemId!;
    expect((first[0] as { itemType?: string }).itemType).toBe("assistant_message");
    expect((first[1] as { itemId: string; delta: string }).itemId).toBe(itemId);
    expect((first[1] as { delta: string }).delta).toBe("Hello");

    // Second chunk → only content.delta on the same item.
    expect(second.map((e) => e.type)).toEqual(["content.delta"]);
    expect((second[0] as { itemId: string; delta: string }).itemId).toBe(itemId);
    expect((second[0] as { delta: string }).delta).toBe(" world");
  });

  it("drops user_message_chunk echoes — supervisor/renderer own the user_message item", () => {
    // Some ACP servers (Copilot) echo the user's prompt back as
    // `user_message_chunk` updates after we send `session/prompt`. The
    // supervisor (or the renderer's optimistic push) has already emitted the
    // user_message with a stable id, so surfacing the echo would duplicate
    // the message in the chat pane with a fresh, undeduppable id.
    const state = createAcpMapperState("t-echo");
    const events = mapAcpSessionUpdate(
      note({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "hi" } }),
      state,
    );
    expect(events).toEqual([]);
    expect(state.openUserItemId).toBeUndefined();
  });

  it("brackets reasoning items independently from assistant items", () => {
    const state = createAcpMapperState("t-2");

    mapAcpSessionUpdate(
      note({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } }),
      state,
    );
    const switchToReasoning = mapAcpSessionUpdate(
      note({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking..." },
      }),
      state,
    );

    // Switching to reasoning must close the assistant item then open a reasoning item.
    expect(switchToReasoning.map((e) => e.type)).toEqual([
      "item.completed",
      "item.started",
      "content.delta",
    ]);
    expect((switchToReasoning[1] as { itemType: string }).itemType).toBe("reasoning");
    expect(state.openAssistantItemId).toBeUndefined();
    expect(state.openReasoningItemId).toBeDefined();
  });

  it("starts a tool_call item, streams updates, and seals on terminal status", () => {
    const state = createAcpMapperState("t-3");

    const started = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "shell exec",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "pnpm run test", cwd: "C:\\repo" },
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(started[0]?.type).toBe("item.started");
    expect((started[0] as { itemType: string }).itemType).toBe("command_execution");
    // Canonical command_execution payload must carry `command`/`cwd` so the
    // chat renderer can surface them — ACP's source shape is `rawInput.{...}`.
    const startedPayload = (started[0] as { payload: Record<string, unknown> }).payload;
    expect(startedPayload.command).toBe("pnpm run test");
    expect(startedPayload.cwd).toBe("C:\\repo");
    // Original ACP fields stay on the payload so the accordion body can show
    // both the request and the eventual result.
    expect(startedPayload.name).toBe("shell exec");
    expect(startedPayload.args).toEqual({ command: "pnpm run test", cwd: "C:\\repo" });

    const updated = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "in_progress",
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(updated[0]?.type).toBe("item.updated");

    const completed = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "completed",
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(completed[0]?.type).toBe("item.completed");
    // Item map cleared so subsequent updates with the same id are ignored.
    expect(state.toolCallItems.has("tc-1")).toBe(false);
  });

  it("seals orphaned tool calls at turn end", () => {
    const state = createAcpMapperState("t-stop-tool");
    const started = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-stop",
        title: "shell exec",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "pnpm run test" },
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    const itemId = (started[0] as { itemId: string }).itemId;

    expect(closeOpenTurnItems(state)).toEqual([
      { type: "item.completed", threadId: "t-stop-tool", itemId },
    ]);
    expect(state.toolCallItems.size).toBe(0);
  });

  it("seals open plans at turn end without leaving active steps in progress", () => {
    const state = createAcpMapperState("t-stop-plan");
    const started = mapAcpSessionUpdate(
      note({
        sessionUpdate: "plan",
        entries: [
          { content: "Inspect output", status: "completed" },
          { content: "Patch UI", status: "in_progress" },
          { content: "Verify", status: "pending" },
        ],
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    const itemId = (started[0] as { itemId: string }).itemId;

    expect(closeOpenTurnItems(state)).toEqual([
      {
        type: "item.completed",
        threadId: "t-stop-plan",
        itemId,
        payload: {
          steps: [
            { step: "Inspect output", status: "completed" },
            { step: "Patch UI", status: "pending" },
            { step: "Verify", status: "pending" },
          ],
        },
      },
    ]);
    expect(state.openPlanItemId).toBeUndefined();
    expect(state.openPlanSteps).toBeUndefined();
  });

  it("extracts file_change path from apply_patch text args", () => {
    const state = createAcpMapperState("t-fc");
    const events = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-fc",
        title: "apply_patch",
        kind: "edit",
        status: "in_progress",
        rawInput: "*** Begin Patch\n*** Update File: src/foo.ts\n@@\n-old\n+new\n*** End Patch",
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    const started = events[0] as { itemType: string; payload: Record<string, unknown> };
    expect(started.itemType).toBe("file_change");
    expect(started.payload.path).toBe("src/foo.ts");
    expect(started.payload.changeKind).toBe("edit");
  });

  it("extracts web_search query from rawInput.query", () => {
    const state = createAcpMapperState("t-ws");
    const events = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-ws",
        title: "github-mcp-server-search_code",
        kind: "search",
        status: "in_progress",
        rawInput: { query: "repo:foo bar", page: 1 },
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    const started = events[0] as { itemType: string; payload: Record<string, unknown> };
    expect(started.itemType).toBe("web_search");
    expect(started.payload.query).toBe("repo:foo bar");
  });

  it("reroutes Copilot's `task_complete` tool call to an assistant_message", () => {
    // Copilot emits the end-of-turn wrap-up as a `tool_call` named
    // `task_complete`. It isn't a real tool — surface it as an assistant
    // message so it renders inline, not as a collapsed accordion. The
    // matching `tool_call_update` is suppressed (no ghost item update).
    const state = createAcpMapperState("t-tc");
    const summary = "Done. Here is what changed: ...";
    const started = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-summary",
        title: "task_complete",
        kind: "other",
        status: "in_progress",
        rawInput: { summary },
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(started.map((e) => e.type)).toEqual(["item.started", "content.delta", "item.completed"]);
    expect((started[0] as { itemType: string }).itemType).toBe("assistant_message");
    expect((started[1] as { delta: string }).delta).toBe(summary);
    expect(state.toolCallItems.has("tc-summary")).toBe(false);
    expect(state.suppressedToolCallIds.has("tc-summary")).toBe(true);

    const updated = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-summary",
        status: "completed",
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(updated).toEqual([]);
    expect(state.suppressedToolCallIds.has("tc-summary")).toBe(false);
  });

  it("accepts a plain-string `task_complete` rawInput", () => {
    const state = createAcpMapperState("t-tc-str");
    const events = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-str",
        title: "task_complete",
        rawInput: "All set.",
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect((events[1] as { delta: string }).delta).toBe("All set.");
  });

  it("drops Gemini's `update_topic` tool call entirely", () => {
    // Gemini emits `update_topic` on nearly every user turn as a "think"-kind
    // meta-tool to label the current conversation topic. It produces no
    // user-facing artifact and would otherwise render as a collapsed accordion
    // sandwiched between the user message and the assistant reply, so the
    // mapper drops the `tool_call` and its terminal `tool_call_update`.
    const state = createAcpMapperState("t-topic");
    const started = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-topic",
        title: 'Update topic to: "Capabilities Overview"',
        kind: "think",
        status: "in_progress",
        rawInput: { title: "Capabilities Overview" },
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(started).toEqual([]);
    expect(state.toolCallItems.has("tc-topic")).toBe(false);
    expect(state.suppressedToolCallIds.has("tc-topic")).toBe(true);

    const completed = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-topic",
        status: "completed",
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(completed).toEqual([]);
    expect(state.suppressedToolCallIds.has("tc-topic")).toBe(false);
  });

  it("also drops `update_topic` when the title is the raw tool name", () => {
    const state = createAcpMapperState("t-topic-raw");
    const events = mapAcpSessionUpdate(
      note({
        sessionUpdate: "tool_call",
        toolCallId: "tc-topic-raw",
        title: "update_topic",
        kind: "think",
      } as Parameters<typeof mapAcpSessionUpdate>[0]["update"]),
      state,
    );
    expect(events).toEqual([]);
    expect(state.suppressedToolCallIds.has("tc-topic-raw")).toBe(true);
  });

  it("ignores unknown sessionUpdate kinds without throwing", () => {
    const state = createAcpMapperState("t-4");
    const events = mapAcpSessionUpdate(
      // Casting because session_info_update et al. aren't pulled from `update` lib types here.
      note({ sessionUpdate: "session_info_update" } as Parameters<
        typeof mapAcpSessionUpdate
      >[0]["update"]),
      state,
    );
    expect(events).toEqual([]);
  });
});
