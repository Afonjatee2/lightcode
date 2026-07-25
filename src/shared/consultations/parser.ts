import type { ConsultationMode, ConsultationRole } from "./types";
import type { ModelAlias } from "@/shared/modelAliases";
import { buildModelAliasLookup } from "@/shared/modelAliases";
import { resolveCommand } from "./resolve";
import { COMMAND_ALIASES, KNOWN_MENTIONS, PROVIDER_ALIASES, ROLE_ALIASES } from "./builtInMentions";

export const MENTION_PARSE_ERROR_CODES = [
  "unknown_mention",
  "missing_instruction",
  "ambiguous_mention",
  "unsupported_provider",
] as const;
export type MentionParseErrorCode = (typeof MENTION_PARSE_ERROR_CODES)[number];

export interface MentionParseResult {
  success: true;
  resolvedRole: ConsultationRole;
  requestedProvider: string | null;
  requestedModel: string | null;
  requestedEffort: string | null;
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

export interface ParseMentionOptions {
  modelAliases?: readonly ModelAlias[];
}

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
 * 4. User model aliases (settings registry) — same routing as provider-only,
 *    but populate requested provider/model/effort from the alias entry. Built-in
 *    mentions always take precedence over registry aliases.
 * 5. Hyphen and underscore are treated as equivalent for role aliases. Case is
 *    ignored for all tokens.
 */

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const QUOTED_LINE_RE = /^[ \t]*>.*$/gm;

const MENTION_PATTERN = /(?:^|\s)@([\w][\w.-]*)/;

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

interface ParseContext {
  aliasLookup: ReadonlyMap<string, ModelAlias>;
}

function isRecognizedToken(raw: string, context: ParseContext): boolean {
  return KNOWN_MENTIONS.has(raw) || context.aliasLookup.has(raw);
}

function extractMentionTokens(input: string, context: ParseContext): RawToken[] {
  const sanitised = sanitiseInput(input);
  const tokens: RawToken[] = [];
  const seen = new Set<string>();
  const re = new RegExp(MENTION_PATTERN.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(sanitised)) !== null) {
    const raw = match[1]!.toLowerCase();
    if (!isRecognizedToken(raw, context)) continue;
    const atPos = match.index + match[0].indexOf("@");
    const email = isPartOfEmail(sanitised, atPos);
    if (!seen.has(raw)) {
      seen.add(raw);
      tokens.push({ token: raw, position: match.index, isEmail: email });
    }
  }
  return tokens;
}

function extractInstruction(input: string, context: ParseContext): string {
  const sanitised = sanitiseInput(input);
  const re = new RegExp(MENTION_PATTERN.source, "gi");
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sanitised)) !== null) {
    const raw = match[1]!.toLowerCase();
    if (isRecognizedToken(raw, context)) {
      const after = match.index + match[0].length;
      if (after > lastEnd) lastEnd = after;
    }
  }
  return input.slice(lastEnd).trim();
}

function buildOriginalMention(input: string, context: ParseContext): string {
  const sanitised = sanitiseInput(input);
  const re = new RegExp(MENTION_PATTERN.source, "gi");
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(sanitised)) !== null) {
    const raw = match[1]!.toLowerCase();
    if (isRecognizedToken(raw, context)) {
      parts.push(`@${raw}`);
    }
  }
  const instruction = extractInstruction(input, context);
  const mention = parts.join(" ");
  return instruction ? `${mention} ${instruction}` : mention;
}

function resolveRoutingFromTokens(input: {
  commandToken: string | null;
  roleToken: string | null;
  providerToken: string | null;
  userAliasToken: string | null;
  aliasLookup: ReadonlyMap<string, ModelAlias>;
}): Pick<MentionParseResult, "requestedProvider" | "requestedModel" | "requestedEffort"> {
  if (input.userAliasToken) {
    const alias = input.aliasLookup.get(input.userAliasToken)!;
    return {
      requestedProvider: alias.provider,
      requestedModel: alias.model,
      requestedEffort: alias.effort ?? null,
    };
  }
  return {
    requestedProvider: input.providerToken ? PROVIDER_ALIASES[input.providerToken]! : null,
    requestedModel: null,
    requestedEffort: null,
  };
}

function successResult(
  input: string,
  context: ParseContext,
  fields: Omit<MentionParseResult, "success" | "originalMention" | "instruction">,
): MentionParseResult {
  return {
    success: true,
    ...fields,
    originalMention: buildOriginalMention(input, context),
    instruction: extractInstruction(input, context),
  };
}

export function parseMention(input: string, options?: ParseMentionOptions): ParseOutcome {
  const context: ParseContext = {
    aliasLookup: buildModelAliasLookup(options?.modelAliases ?? []),
  };

  if (!input || input.trim().length === 0) {
    return {
      success: false,
      code: "missing_instruction",
      message: "No mention found in the input",
      token: null,
    };
  }

  const tokens = extractMentionTokens(input, context);

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
  let userAliasToken: string | null = null;

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
    } else if (context.aliasLookup.has(token)) {
      if (userAliasToken && userAliasToken !== token) {
        return {
          success: false,
          code: "ambiguous_mention",
          message: `Multiple model aliases specified: @${userAliasToken} and @${token}`,
          token,
        };
      }
      userAliasToken = token;
    }
  }

  const routing = resolveRoutingFromTokens({
    commandToken,
    roleToken,
    providerToken,
    userAliasToken,
    aliasLookup: context.aliasLookup,
  });

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
    const instruction = extractInstruction(input, context);
    if (instruction.length === 0) {
      return {
        success: false,
        code: "missing_instruction",
        message: `@${commandToken} requires an instruction`,
        token: commandToken,
      };
    }
    return successResult(input, context, {
      resolvedRole: resolved.role,
      ...routing,
      commandToken,
      consultationMode: resolved.mode,
    });
  }

  if (roleToken) {
    const role = ROLE_ALIASES[roleToken]!;
    const resolved = resolveCommand(role);
    const instruction = extractInstruction(input, context);
    if (instruction.length === 0) {
      return {
        success: false,
        code: "missing_instruction",
        message: `@${roleToken} requires an instruction`,
        token: roleToken,
      };
    }
    const mode = resolved?.mode ?? "standard";
    return successResult(input, context, {
      resolvedRole: role,
      ...routing,
      commandToken: null,
      consultationMode: mode,
    });
  }

  if (providerToken || userAliasToken) {
    const instruction = extractInstruction(input, context);
    if (instruction.length === 0) {
      const token = providerToken ?? userAliasToken!;
      return {
        success: false,
        code: "missing_instruction",
        message: `@${token} requires an instruction`,
        token,
      };
    }
    return successResult(input, context, {
      resolvedRole: "daily_operator",
      ...routing,
      commandToken: null,
      consultationMode: "standard",
    });
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

export { COMMAND_ALIASES, KNOWN_MENTIONS, PROVIDER_ALIASES, ROLE_ALIASES } from "./builtInMentions";
