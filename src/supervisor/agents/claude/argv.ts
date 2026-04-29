import type { ThreadConfig } from "@/shared/contracts";
import { CLAUDE_DEFAULT_APPROVAL_POLICY } from "./detection";

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
    args.push("--model", config.model);
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
