import type { ThreadConfig } from "@/shared/contracts";

export function buildCursorArgs(
  config: ThreadConfig,
  prompt: string,
  resumeSessionId?: string,
): string[] {
  const args: string[] = [];

  if (resumeSessionId) {
    args.push(`--resume=${resumeSessionId}`);
  }
  args.push("--model", config.model || "auto");
  if (config.mode === "plan") {
    args.push("--mode", "plan");
  }
  if (config.approvalPolicy === "never") {
    args.push("--yolo");
  }
  if (prompt.trim().length > 0) {
    args.push(prompt);
  }

  return args;
}
