import type { SessionNotification } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { isAcpSubAgentToolCall } from "../acp/canonicalMapping/subagents";
import { transformKimiAcpSessionUpdate } from "./acpTransform";

function toolCall(overrides: Record<string, unknown>): SessionNotification {
  return {
    sessionId: "ses-1",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "tc-agent",
      status: "pending",
      ...overrides,
    },
  } as unknown as SessionNotification;
}

function transformedRawInput(input: SessionNotification): Record<string, unknown> {
  return (transformKimiAcpSessionUpdate(input).update as { rawInput?: unknown }).rawInput as Record<
    string,
    unknown
  >;
}

describe("transformKimiAcpSessionUpdate", () => {
  it("recovers subagent_type and description from a Kimi launch title", () => {
    // Verbatim shape Kimi's ACP server sends for its `Agent` tool: a human
    // title, `kind: "other"`, and no rawInput.
    const input = toolCall({
      kind: "other",
      title: "Launching explore agent: Investigate PWA state bugs 3-7",
    });
    const rawInput = transformedRawInput(input);
    expect(rawInput).toMatchObject({
      subagent_type: "explore",
      description: "Investigate PWA state bugs 3-7",
    });
    expect(isAcpSubAgentToolCall({ rawInput })).toBe(true);
  });

  it("recognizes background agent launches", () => {
    const input = toolCall({
      kind: "other",
      title: "Launching background coder agent: Serve local images to PWA",
    });
    expect(transformedRawInput(input)).toMatchObject({
      subagent_type: "coder",
      description: "Serve local images to PWA",
      background: true,
    });
  });

  it("also normalizes tool_call_update notifications", () => {
    const input = toolCall({
      sessionUpdate: "tool_call_update",
      status: "completed",
      title: "Launching explore agent: Investigate PWA state bugs 3-7",
      rawOutput: "agent_id: agent-0\nactual_subagent_type: explore\nstatus: completed",
    });
    expect(transformedRawInput(input)).toMatchObject({ subagent_type: "explore" });
  });

  it("preserves an existing rawInput subagent_type untouched", () => {
    const input = toolCall({
      title: "Launching explore agent: Investigate",
      rawInput: { subagent_type: "custom", prompt: "p" },
    });
    expect(transformKimiAcpSessionUpdate(input)).toBe(input);
  });

  it("merges recovered fields into an existing rawInput", () => {
    const input = toolCall({
      title: "Launching explore agent: Investigate",
      rawInput: { prompt: "the full prompt" },
    });
    expect(transformedRawInput(input)).toMatchObject({
      prompt: "the full prompt",
      subagent_type: "explore",
      description: "Investigate",
    });
  });

  it("ignores ordinary tool calls and non-tool updates", () => {
    const read = toolCall({ kind: "read", title: "Reading src/mobile/views/ThreadView.tsx" });
    expect(transformKimiAcpSessionUpdate(read)).toBe(read);
    const untitled = toolCall({ kind: "other" });
    expect(transformKimiAcpSessionUpdate(untitled)).toBe(untitled);
    const chunk = {
      sessionId: "ses-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
    } as unknown as SessionNotification;
    expect(transformKimiAcpSessionUpdate(chunk)).toBe(chunk);
  });
});
