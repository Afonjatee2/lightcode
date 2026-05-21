import type { ThreadConfig } from "@/shared/contracts";

export function buildAntigravityArgs(
  config: ThreadConfig,
  prompt: string,
  resumeConversationId?: string,
): string[] {
  const args: string[] = [];

  if (resumeConversationId) {
    args.push("--conversation", resumeConversationId);
  }
  if (config.approvalPolicy === "never" || config.approvalPolicy === "yolo") {
    args.push("--dangerously-skip-permissions");
  }
  if (config.sandboxMode === "sandbox") {
    args.push("--sandbox");
  }
  if (prompt.trim().length > 0) {
    args.push("--prompt-interactive", prompt);
  }
  return args;
}
