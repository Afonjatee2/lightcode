import type { ThreadConfig } from "@/shared/contracts";

export function buildGeminiArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = [];

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  if (config.model) {
    args.push("--model", config.model);
  }
  if (config.mode === "plan") {
    args.push("--approval-mode=plan");
  } else if (config.approvalPolicy === "never" || config.approvalPolicy === "yolo") {
    args.push("--approval-mode=yolo");
  } else if (config.approvalPolicy === "auto_edit") {
    args.push("--approval-mode=auto_edit");
  }
  if (prompt.trim().length > 0) {
    args.push("--prompt-interactive", prompt);
  }
  return args;
}
