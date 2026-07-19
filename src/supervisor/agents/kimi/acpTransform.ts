/**
 * Kimi-specific ACP `session/update` normalization.
 *
 * Why this exists: Kimi's ACP server sends its sub-agent launches (the internal
 * `Agent` tool) as plain `tool_call` notifications with no `rawInput` at all —
 * only a human title like `Launching explore agent: <description>` (or
 * `Launching background coder agent: <description>`) and `kind: "other"`. The
 * shared ACP mapper detects sub-agents from `rawInput` fields
 * (`subagent_type` / `agent_type` / `_toolName: "task"`), so without input the
 * call renders as a generic tool row: no nested sub-agent presentation, no
 * composer activity tile, and the raw `agent_id:` / `actual_subagent_type:`
 * result text dumped verbatim into the accordion.
 *
 * This module recovers the sub-agent identity from the launch title and
 * injects the canonical `subagent_type` (plus `description`) into `rawInput`,
 * which is all the shared detection (`isAcpSubAgentToolCall`) needs. It is
 * wired only into the Kimi adapter's `createStructuredSession()` and never
 * touches shared mapping code. Pure, narrow, and never throws: anything that
 * isn't a matching tool call passes through untouched, and a `rawInput` that
 * already names a sub-agent type is preserved as-is.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk";

// `Launching explore agent: Investigate PWA state bugs` /
// `Launching background coder agent: Serve local images to PWA`
const KIMI_SUBAGENT_TITLE = /^Launching\s+(background\s+)?([\w-]+)\s+agent:\s*(.*)$/i;

export function transformKimiAcpSessionUpdate(
  notification: SessionNotification,
): SessionNotification {
  const update = notification.update;
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return notification;
  }
  const tool = update as { title?: unknown; rawInput?: unknown };
  const title = typeof tool.title === "string" ? tool.title.trim() : "";
  const match = KIMI_SUBAGENT_TITLE.exec(title);
  if (!match) return notification;
  const rawInput = isPlainRecord(tool.rawInput) ? tool.rawInput : {};
  const existingType = rawInput.subagent_type;
  if (typeof existingType === "string" && existingType.length > 0) return notification;
  const [, background, subagentType, description] = match;
  return {
    ...notification,
    update: {
      ...update,
      rawInput: {
        ...rawInput,
        subagent_type: subagentType!.toLowerCase(),
        ...(description ? { description } : {}),
        ...(background ? { background: true } : {}),
      },
    } as SessionNotification["update"],
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
