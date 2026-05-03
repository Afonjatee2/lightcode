import type { ThreadConfig } from "@/shared/contracts";
import { CLAUDE_DEFAULT_APPROVAL_POLICY } from "./detection";

/**
 * Re-attach the `[<size>]` suffix Claude's CLI uses to pick a context-window
 * variant. Strips any pre-existing suffix so the chosen `contextSize` always
 * wins over a stale value baked into a legacy `model` id.
 */
export function applyClaudeContextSuffix(model: string, contextSize?: string): string {
  const base = model.replace(/\[[0-9]+[mk]\]$/i, "");
  if (!contextSize) return base;
  return `${base}[${contextSize}]`;
}

export function buildClaudeArgs(
  config: ThreadConfig,
  prompt: string,
  sessionId?: string,
  assignedSessionId?: string,
): string[] {
  const args: string[] = [];

  if (sessionId) {
    args.push("--resume", sessionId);
  } else if (assignedSessionId) {
    args.push("--session-id", assignedSessionId);
  }

  if (config.model) {
    args.push("--model", applyClaudeContextSuffix(config.model, config.contextSize));
  }
  if (config.effort) {
    args.push("--effort", config.effort);
  }

  args.push("--allow-dangerously-skip-permissions");

  const permissionMode =
    config.mode === "plan" ? "plan" : (config.approvalPolicy ?? CLAUDE_DEFAULT_APPROVAL_POLICY);
  args.push("--permission-mode", permissionMode);

  if (prompt.trim().length > 0) {
    args.push(prompt);
  }
  return args;
}
