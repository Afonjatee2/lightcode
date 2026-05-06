import { describe, expect, it } from "vitest";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { createAcpMapperState, mapAcpSessionUpdate } from "./canonicalMapping";

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
