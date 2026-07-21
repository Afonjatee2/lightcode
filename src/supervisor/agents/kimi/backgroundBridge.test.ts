import type { SessionNotification } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import {
  PORACODE_ACP_DETACHED_SUBAGENT_ACTIVITY_META_KEY,
  PORACODE_ACP_NEW_ASSISTANT_ITEM_META_KEY,
  PORACODE_ACP_PARENT_TOOL_CALL_ID_META_KEY,
} from "../acp/canonicalMapping";
import {
  createKimiBackgroundBridge,
  parseCompletedKimiWireTurns,
  parseKimiTaskRecord,
} from "./backgroundBridge";

function wireLine(time: number, event: Record<string, unknown>): string {
  return JSON.stringify({ type: "context.append_loop_event", event, time });
}

describe("Kimi background subagent bridge", () => {
  it("parses terminal task metadata defensively", () => {
    expect(parseKimiTaskRecord('{"status":"completed","endedAt":42}')).toEqual({
      status: "completed",
      endedAt: 42,
    });
    expect(parseKimiTaskRecord("not-json")).toBeUndefined();
    expect(parseKimiTaskRecord('{"endedAt":42}')).toBeUndefined();
  });

  it("collects text from completed Kimi wire turns", () => {
    const wire = [
      wireLine(10, {
        type: "content.part",
        turnId: "1",
        part: { type: "text", text: "first " },
      }),
      wireLine(11, {
        type: "tool.call",
        turnId: "1",
        args: { path: "/kimi/tasks/agent-task/output.log" },
      }),
      wireLine(11, {
        type: "content.part",
        turnId: "1",
        part: { type: "text", text: "second" },
      }),
      wireLine(12, { type: "step.end", turnId: "1", finishReason: "end_turn" }),
      "partial-json",
    ].join("\n");
    expect(parseCompletedKimiWireTurns(wire)).toEqual([
      {
        turnId: "1",
        firstTime: 10,
        lastTime: 12,
        text: "first second",
        taskIds: ["agent-task"],
      },
    ]);
  });

  it("associates automatic turns that retrieve results through TaskOutput", () => {
    const wire = [
      wireLine(20, {
        type: "tool.call",
        turnId: "2",
        name: "TaskOutput",
        args: { task_id: "agent-task" },
      }),
      wireLine(21, {
        type: "content.part",
        turnId: "2",
        part: { type: "text", text: "automatic reply" },
      }),
      wireLine(22, { type: "step.end", turnId: "2", finishReason: "end_turn" }),
    ].join("\n");

    expect(parseCompletedKimiWireTurns(wire)).toEqual([
      {
        turnId: "2",
        firstTime: 20,
        lastTime: 22,
        text: "automatic reply",
        taskIds: ["agent-task"],
      },
    ]);
  });

  it("re-emits task output, automatic reply, and terminal tool status", async () => {
    const initialWire = [
      wireLine(100, {
        type: "content.part",
        turnId: "0",
        part: { type: "text", text: "launched" },
      }),
      wireLine(101, { type: "step.end", turnId: "0", finishReason: "end_turn" }),
    ].join("\n");
    const completedWire = [
      initialWire,
      wireLine(201, {
        type: "tool.call",
        turnId: "1",
        args: { path: "/kimi/tasks/agent-task/output.log" },
      }),
      wireLine(201, {
        type: "content.part",
        turnId: "1",
        part: { type: "text", text: "final answer" },
      }),
      wireLine(202, { type: "step.end", turnId: "1", finishReason: "end_turn" }),
    ].join("\n");
    let wireReads = 0;
    const readText = vi.fn<
      (location: ProjectLocation, path: string, maxBytes?: number) => Promise<string | undefined>
    >(async (_location, path) => {
      if (path.endsWith("/wire.jsonl")) {
        wireReads += 1;
        return wireReads === 1 ? initialWire : completedWire;
      }
      if (path.endsWith("/agent-task.json")) {
        return '{"status":"completed","endedAt":200}';
      }
      if (path.endsWith("/agent-task/output.log")) return "child result";
      return undefined;
    });
    const updates: SessionNotification[] = [];
    const bridge = createKimiBackgroundBridge(
      { kind: "posix", path: "/repo" },
      (notification) => updates.push(notification),
      {
        readText,
        resolveSessionDir: async () => "/kimi/session",
        pollIntervalMs: 1,
      },
    );

    bridge.onBackgroundLaunch({
      sessionId: "session-1",
      toolCallId: "tool-1",
      taskId: "agent-task",
    });
    await vi.waitFor(() => expect(updates).toHaveLength(3));
    bridge.dispose();

    expect(updates.map((notification) => notification.update.sessionUpdate)).toEqual([
      "agent_message_chunk",
      "agent_message_chunk",
      "tool_call_update",
    ]);
    expect(updates[0]?.update).toMatchObject({
      content: { type: "text", text: "child result" },
      _meta: { [PORACODE_ACP_PARENT_TOOL_CALL_ID_META_KEY]: "tool-1" },
    });
    expect(updates[1]?.update).toMatchObject({
      content: { type: "text", text: "final answer" },
      _meta: { [PORACODE_ACP_NEW_ASSISTANT_ITEM_META_KEY]: true },
    });
    expect(updates[2]?.update).toMatchObject({
      toolCallId: "tool-1",
      status: "completed",
      rawOutput: "child result",
      _meta: { [PORACODE_ACP_DETACHED_SUBAGENT_ACTIVITY_META_KEY]: "tool-1" },
    });
  });
});
