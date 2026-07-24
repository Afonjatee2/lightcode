import type { ConsultationMode, ConsultationRole } from "./types";
import { resolveCommand } from "./resolve";

export const MENTION_PARSE_ERROR_CODES = [
  "unknown_mention",
  "missing_instruction",
  "ambiguous_mention",
  "unsupported_provider",
] as const;
export type MentionParseErrorCode = (typeof MENTION_PARSE_ERROR_CODES)[number];

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

export interface MentionParseResult {
  success: true;
  resolvedRole: ConsultationRole;
  requestedProvider: string | null;
  commandToken: string | null;
  consultationMode: ConsultationMode;
  originalMention: string;
  instruction: string;
}

export interface MentionParseError {
  success: false;
  code: MentionParseErrorCode;
  message: string;
  token: string | null;
}

export type ParseOutcome = MentionParseResult | MentionParseError;

/**
 * Mention precedence rules (highest first):
 * 1. Commands (@verify @challenge @research @panel @finalise @handoff) — set
 *    the consultation mode; the role is derived from the command. When both a
 *    command and a role are present, the command wins for role derivation.
 *    A paired provider is applied to the resolved command.
 * 2. Role aliases (@daily-operator @strategic-reviewer @figures-auditor) — set
 *    the role. Hyphen and underscore variants are accepted. May be paired with
 *    a provider for routing to that provider.
 * 3. Provider-only (@codex @claude @kimi @qwen @deepseek) — when used without
 *    a role or command, defaults to daily_operator role. Provider-only is
 *    valid as long as an instruction follows.
 * 4. Hyphen and underscore are treated as equivalent for role aliases. Case is
 *    ignored for all tokens.
 */

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const QUOTED_LINE_RE = /^[ \t]*>.*$/gm;

const MENTION_PATTERN = /(?:^|\s)@([\w][\w-]*)/;

function sanitiseInput(input: string): string {
  let sanitised = input.replace(CODE_BLOCK_RE, (m) => " ".repeat(m.length));
  sanitised = sanitised.replace(INLINE_CODE_RE, (m) => " ".repeat(m.length));
  sanitised = sanitised.replace(QUOTED_LINE_RE, (m) => " ".repeat(m.length));
  return sanitised;
}

function isPartOfEmail(fullText: string, atIndex: number): boolean {
  if (atIndex <= 0) return false;
  const precededByWord = /\w/.test(fullText[atIndex - 1] ?? "");
  if (!precededByWord) return false;
  const after = fullText.slice(atIndex + 1);
  return /^[\w-]+\./.test(after);
}

interface RawToken {
  token: string;
  position: number;
  isEmail: boolean;
}

function extractMentionTokens(input: string): RawToken[] {
  const sanitised = sanitiseInput(input);
  const tokens: RawToken[] = [];
  const seen = new Set<string>();
  const re = new RegExp(MENTION_PATTERN.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(sanitised)) !== null) {
    const raw = match[1]!.toLowerCase();
    if (!KNOWN_MENTIONS.has(raw)) continue;
    const atPos = match.index + match[0].indexOf("@");
    const email = isPartOfEmail(sanitised, atPos);
    if (!seen.has(raw)) {
      seen.add(raw);
      tokens.push({ token: raw, position: match.index, isEmail: email });
    }
  }
  return tokens;
}

function extractInstruction(input: string): string {
  const sanitised = sanitiseInput(input);
  const re = new RegExp(MENTION_PATTERN.source, "gi");
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sanitised)) !== null) {
    const raw = match[1]!.toLowerCase();
    if (KNOWN_MENTIONS.has(raw)) {
      const after = match.index + match[0].length;
      if (after > lastEnd) lastEnd = after;
    }
  }
  return input.slice(lastEnd).trim();
}

function buildOriginalMention(input: string): string {
  const sanitised = sanitiseInput(input);
  const re = new RegExp(MENTION_PATTERN.source, "gi");
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(sanitised)) !== null) {
    const raw = match[1]!.toLowerCase();
    if (KNOWN_MENTIONS.has(raw)) {
      parts.push(`@${raw}`);
    }
  }
  const instruction = extractInstruction(input);
  const mention = parts.join(" ");
  return instruction ? `${mention} ${instruction}` : mention;
}

export function parseMention(input: string): ParseOutcome {
  if (!input || input.trim().length === 0) {
    return {
      success: false,
      code: "missing_instruction",
      message: "No mention found in the input",
      token: null,
    };
  }

  const tokens = extractMentionTokens(input);

  if (tokens.length === 0) {
    return {
      success: false,
      code: "unknown_mention",
      message: "No known consultation mention found",
      token: null,
    };
  }

  const emailToken = tokens.find((t) => t.isEmail);
  if (emailToken) {
    return {
      success: false,
      code: "unknown_mention",
      message: `"@${emailToken.token}" appears to be an email address and will not trigger a consultation`,
      token: emailToken.token,
    };
  }

  let commandToken: string | null = null;
  let roleToken: string | null = null;
  let providerToken: string | null = null;

  for (const { token } of tokens) {
    if (COMMAND_ALIASES[token]) {
      if (commandToken && commandToken !== token) {
        return {
          success: false,
          code: "ambiguous_mention",
          message: `Multiple commands specified: @${commandToken} and @${token}`,
          token,
        };
      }
      commandToken = token;
    } else if (ROLE_ALIASES[token]) {
      if (roleToken && roleToken !== token) {
        return {
          success: false,
          code: "ambiguous_mention",
          message: `Multiple roles specified: @${roleToken} and @${token}`,
          token,
        };
      }
      roleToken = token;
    } else if (PROVIDER_ALIASES[token]) {
      if (providerToken && providerToken !== token) {
        return {
          success: false,
          code: "ambiguous_mention",
          message: `Multiple providers specified: @${providerToken} and @${token}`,
          token,
        };
      }
      providerToken = token;
    }
  }

  if (commandToken) {
    const resolved = resolveCommand(commandToken);
    if (!resolved) {
      return {
        success: false,
        code: "unknown_mention",
        message: `Could not resolve command: @${commandToken}`,
        token: commandToken,
      };
    }
    const instruction = extractInstruction(input);
    if (instruction.length === 0) {
      return {
        success: false,
        code: "missing_instruction",
        message: `@${commandToken} requires an instruction`,
        token: commandToken,
      };
    }
    return {
      success: true,
      resolvedRole: resolved.role,
      requestedProvider: providerToken ? PROVIDER_ALIASES[providerToken]! : null,
      commandToken,
      consultationMode: resolved.mode,
      originalMention: buildOriginalMention(input),
      instruction,
    };
  }

  if (roleToken) {
    const role = ROLE_ALIASES[roleToken]!;
    const resolved = resolveCommand(role);
    const instruction = extractInstruction(input);
    if (instruction.length === 0) {
      return {
        success: false,
        code: "missing_instruction",
        message: `@${roleToken} requires an instruction`,
        token: roleToken,
      };
    }
    const mode = resolved?.mode ?? "standard";
    return {
      success: true,
      resolvedRole: role,
      requestedProvider: providerToken ? PROVIDER_ALIASES[providerToken]! : null,
      commandToken: null,
      consultationMode: mode,
      originalMention: buildOriginalMention(input),
      instruction,
    };
  }

  if (providerToken) {
    const instruction = extractInstruction(input);
    if (instruction.length === 0) {
      return {
        success: false,
        code: "missing_instruction",
        message: `@${providerToken} requires an instruction`,
        token: providerToken,
      };
    }
    const provider = PROVIDER_ALIASES[providerToken]!;
    return {
      success: true,
      resolvedRole: "daily_operator",
      requestedProvider: provider,
      commandToken: null,
      consultationMode: "standard",
      originalMention: buildOriginalMention(input),
      instruction,
    };
  }

  return {
    success: false,
    code: "unknown_mention",
    message: "No known consultation mention found",
    token: null,
  };
}

export function isMentionParseError(outcome: ParseOutcome): outcome is MentionParseError {
  return outcome.success === false;
}
