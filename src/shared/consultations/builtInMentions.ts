import type { ConsultationRole } from "./types";

export const PROVIDER_ALIASES: Record<string, string> = {
  codex: "codex",
  claude: "claude",
  kimi: "kimi",
  qwen: "qwen",
  deepseek: "deepseek",
};

export const ROLE_ALIASES: Record<string, ConsultationRole> = {
  "daily-operator": "daily_operator",
  daily_operator: "daily_operator",
  "strategic-reviewer": "strategic_reviewer",
  strategic_reviewer: "strategic_reviewer",
  "figures-auditor": "figures_auditor",
  figures_auditor: "figures_auditor",
};

export const COMMAND_ALIASES: Record<string, string> = {
  verify: "verify",
  challenge: "challenge",
  research: "research",
  panel: "panel",
  finalise: "finalise",
  finalize: "finalise",
  handoff: "handoff",
};

export const KNOWN_MENTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(PROVIDER_ALIASES),
  ...Object.keys(ROLE_ALIASES),
  ...Object.keys(COMMAND_ALIASES),
]);
