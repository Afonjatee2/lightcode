/**
 * Qwen-specific ACP normalization for native Agent tool calls.
 *
 * Qwen identifies subagents in `_meta`, while the shared ACP mapper consumes
 * canonical `rawInput` fields. Background agents add one more wrinkle: the
 * launch tool call is reported as `completed` even though its `rawOutput`
 * status is `background`, and the eventual result arrives later as a discrete
 * message stream with no terminal update for the original tool call.
 *
 * This stateful, per-session transform bridges those wire shapes without
 * leaking Qwen-specific checks into the shared mapper.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk";
import { PORACODE_ACP_GOAL_META_KEY, type AcpCanonicalGoalUpdate } from "../acp/canonicalMapping";
import {
  createAcpSubagentCoordinator,
  normalizeAcpSubagentToolCall,
  withAcpDetachedSubagentActivity,
  withAcpSubagentParent,
} from "../acp/subagentCoordinator";
import type { AcpSessionUpdateTransform } from "../base";

const BACKGROUND_AGENT_ID_RE = /\bagentId:\s*([^\s(]+)/iu;

export function createQwenAcpSessionUpdateTransform(): AcpSessionUpdateTransform {
  const subagents = createAcpSubagentCoordinator();
  const parentReplyByToolCallId = new Map<string, string>();
  let pendingBoundaryToolCallId: string | undefined;

  return (notification) => {
    const update = notification.update as Record<string, unknown>;
    const sessionUpdate = readString(update, "sessionUpdate");
    const meta = plainRecord(update._meta);
    const toolCallId = readString(update, "toolCallId");
    const isAgentTool = readString(meta, "toolName")?.toLowerCase() === "agent";
    const goal = readQwenGoalUpdate(meta);

    if (goal) {
      return withUpdate(notification, {
        ...update,
        _meta: { ...meta, [PORACODE_ACP_GOAL_META_KEY]: goal },
      });
    }

    if (
      toolCallId &&
      (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") &&
      (isAgentTool || subagents.getCall(toolCallId) !== undefined)
    ) {
      const rawOutput = plainRecord(update.rawOutput);
      const isBackground = readString(rawOutput, "status") === "background";
      const subagentType = readString(rawOutput, "subagentName");
      const description = readString(rawOutput, "taskDescription");
      const prompt = readString(rawOutput, "taskPrompt");
      const descriptor = subagents.updateCall(toolCallId, {
        rawInput: plainRecord(update.rawInput),
        ...(subagentType ? { subagentType } : {}),
        ...(description ? { description } : {}),
        ...(prompt ? { prompt } : {}),
        ...(isBackground ? { background: true } : {}),
      });

      if (isBackground) {
        const taskId = extractBackgroundTaskId(update.content);
        if (taskId) {
          subagents.registerBackgroundLaunch({
            sessionId: notification.sessionId,
            toolCallId,
            taskId,
          });
        }
      }

      const result = readString(rawOutput, "result");
      const normalized = normalizeAcpSubagentToolCall(notification, {
        rawInput: subagents.canonicalInput(toolCallId, update.rawInput),
        detached: descriptor.background,
        keepOpen: isBackground,
        ...(result ? { rawOutput: result } : {}),
        ...(isBackground ? { omitContent: true, omitRawOutput: true } : {}),
      });
      if (!isBackground && (update.status === "completed" || update.status === "failed")) {
        subagents.forgetCall(toolCallId);
      }
      return normalized;
    }

    const explicitParentToolCallId = readString(meta, "parentToolCallId");
    if (explicitParentToolCallId) {
      return withAcpSubagentParent(notification, explicitParentToolCallId);
    }

    const backgroundTask = plainRecord(meta.backgroundTask);
    const backgroundTaskId = readString(backgroundTask, "taskId");
    const backgroundToolCallId = backgroundTaskId
      ? subagents.resolveBackgroundToolCallId(backgroundTaskId)
      : undefined;
    if (backgroundToolCallId) {
      pendingBoundaryToolCallId = backgroundToolCallId;
      if (readString(meta, "source") === "background_notification_response") {
        const text = readTextContent(update.content);
        if (text) parentReplyByToolCallId.set(backgroundToolCallId, text);
      }
      return withAcpDetachedSubagentActivity(notification, backgroundToolCallId);
    }

    if (pendingBoundaryToolCallId && isEmptyAgentMessageBoundary(update)) {
      const completingToolCallId = pendingBoundaryToolCallId;
      pendingBoundaryToolCallId = undefined;
      const result = parentReplyByToolCallId.get(completingToolCallId);
      parentReplyByToolCallId.delete(completingToolCallId);
      return (
        subagents
          .complete({
            sessionId: notification.sessionId,
            toolCallId: completingToolCallId,
            status: "completed",
            ...(result ? { result } : {}),
            terminalMeta: plainRecord(update._meta),
          })
          .at(-1) ?? notification
      );
    }

    if (pendingBoundaryToolCallId && isAgentContentUpdate(sessionUpdate)) {
      return withAcpDetachedSubagentActivity(notification, pendingBoundaryToolCallId);
    }

    return notification;
  };
}

function withUpdate(
  notification: SessionNotification,
  update: Record<string, unknown>,
): SessionNotification {
  return { ...notification, update: update as SessionNotification["update"] };
}

function extractBackgroundTaskId(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const entry of content) {
    const contentRecord = plainRecord(plainRecord(entry).content);
    const text = readString(contentRecord, "text");
    const taskId = text ? BACKGROUND_AGENT_ID_RE.exec(text)?.[1] : undefined;
    if (taskId) return taskId;
  }
  return undefined;
}

function isAgentContentUpdate(sessionUpdate: string | undefined): boolean {
  return sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_thought_chunk";
}

function readTextContent(content: unknown): string | undefined {
  const record = plainRecord(content);
  return readString(record, "type") === "text" ? readString(record, "text") : undefined;
}

function isEmptyAgentMessageBoundary(update: Record<string, unknown>): boolean {
  if (readString(update, "sessionUpdate") !== "agent_message_chunk") return false;
  const content = plainRecord(update.content);
  return readString(content, "type") === "text" && readString(content, "text") === "";
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readQwenGoalUpdate(meta: Record<string, unknown>): AcpCanonicalGoalUpdate | undefined {
  const raw = plainRecord(meta.goalStatus ?? meta.goalTerminal);
  const kind = readString(raw, "kind")?.toLowerCase();
  const objective = readString(raw, "condition")?.trim();
  if (!kind || !objective) return undefined;

  const action = kind === "set" ? "set" : kind === "cleared" ? "cleared" : "updated";
  const status =
    kind === "set" || kind === "checking"
      ? "active"
      : kind === "achieved"
        ? "complete"
        : kind === "failed"
          ? "failed"
          : kind === "aborted"
            ? "cancelled"
            : undefined;
  const setAt = readFiniteNumber(raw, "setAt");
  const durationMs = readNonNegativeNumber(raw, "durationMs");
  const iterations = readNonNegativeInteger(raw, "iterations");
  const lastReason =
    readString(raw, "lastReason")?.trim() ?? readString(raw, "systemMessage")?.trim();

  return {
    action,
    objective,
    ...(status ? { status } : {}),
    ...(durationMs !== undefined ? { timeUsedSeconds: durationMs / 1000 } : {}),
    ...(iterations !== undefined ? { iterations } : {}),
    ...(lastReason ? { lastReason } : {}),
    ...(setAt !== undefined ? { updatedAt: normalizeEpochSeconds(setAt) } : {}),
  };
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = readFiniteNumber(record, key);
  return value !== undefined && value >= 0 ? value : undefined;
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = readNonNegativeNumber(record, key);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

function normalizeEpochSeconds(value: number): number {
  return value > 1_000_000_000_000 ? value / 1000 : value;
}
