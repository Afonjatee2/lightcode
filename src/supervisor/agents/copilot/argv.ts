import type { ThreadConfig } from "@/shared/contracts";
import { sanitizeModelName } from "./terminal";

export function formatCopilotInteractivePrompt(prompt: string, config?: ThreadConfig): string {
  if (config?.mode !== "plan") {
    return prompt;
  }

  const trimmed = prompt.trimStart();
  if (trimmed.startsWith("/")) {
    return prompt;
  }

  return `/plan ${prompt}`;
}

export function buildCopilotArgs(
  config: ThreadConfig,
  prompt: string,
  sessionId: string,
  _launchOptions?: { suppressResumeConfigOverrides?: boolean },
): string[] {
  const args = [`--resume=${sessionId}`, "--allow-all-paths"];
  const formattedPrompt = formatCopilotInteractivePrompt(prompt, config);

  // Copilot's TUI only reflects the selected model/effort when the resume
  // command also carries those flags, even if ACP already applied them.
  // Sanitize: status-line scraping can capture TUI overlay glyphs as the
  // model name; passing those to `--model` makes the CLI error and fall back
  // to "auto", which is fine — but only if we don't pass the bad value.
  const safeModel = sanitizeModelName(config.model);
  if (safeModel) {
    args.push("--model", safeModel);
  }
  if (config.effort) {
    args.push("--effort", config.effort);
  }
  if (config.approvalPolicy === "never") {
    args.push("--yolo");
  }
  if (formattedPrompt.trim().length > 0) {
    args.push("-i", formattedPrompt);
  }

  return args;
}
