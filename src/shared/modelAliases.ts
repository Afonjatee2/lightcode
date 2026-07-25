import { z } from "zod";
import { KNOWN_MENTIONS } from "./consultations/builtInMentions";

export const modelAliasSchema = z.object({
  alias: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  effort: z.string().min(1).optional(),
});

export type ModelAlias = z.infer<typeof modelAliasSchema>;

/** Single @token: word chars, hyphens, and dots (for versioned model ids). */
export const MODEL_ALIAS_TOKEN_RE = /^[\w][\w.-]*$/u;

export type ModelAliasValidationError =
  | { code: "empty_alias" }
  | { code: "invalid_alias" }
  | { code: "duplicate_alias"; alias: string }
  | { code: "reserved_alias"; alias: string };

export function normalizeModelAliasToken(alias: string): string {
  return alias.trim().toLowerCase();
}

export function isReservedModelAlias(alias: string): boolean {
  return KNOWN_MENTIONS.has(normalizeModelAliasToken(alias));
}

export function validateModelAlias(
  alias: string,
  existing: readonly ModelAlias[],
  editingIndex?: number,
): ModelAliasValidationError | null {
  const trimmed = alias.trim();
  if (!trimmed) return { code: "empty_alias" };
  if (!MODEL_ALIAS_TOKEN_RE.test(trimmed)) {
    return { code: "invalid_alias" };
  }
  const normalized = normalizeModelAliasToken(trimmed);
  if (isReservedModelAlias(normalized)) {
    return { code: "reserved_alias", alias: normalized };
  }
  const duplicate = existing.findIndex(
    (entry, index) =>
      index !== editingIndex && normalizeModelAliasToken(entry.alias) === normalized,
  );
  if (duplicate >= 0) {
    return { code: "duplicate_alias", alias: normalized };
  }
  return null;
}

export function buildModelAliasLookup(
  aliases: readonly ModelAlias[],
): ReadonlyMap<string, ModelAlias> {
  const map = new Map<string, ModelAlias>();
  for (const entry of aliases) {
    map.set(normalizeModelAliasToken(entry.alias), entry);
  }
  return map;
}

/**
 * Registry-backed provider ids used for first-run seeding. Only providers that
 * exist in the app's agent registry are included — no invented providers.
 */
export const SEEDABLE_MODEL_ALIAS_PROVIDERS = [
  "codex",
  "claude",
  "gemini",
  "commandcode",
  "kimi",
  "qwen",
] as const;

const SEED_MODEL_ALIAS_CANDIDATES: readonly ModelAlias[] = [
  {
    alias: "gpt-5.6-sol-high",
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
  },
  {
    alias: "deepseek-v4-pro",
    provider: "commandcode",
    model: "deepseek/deepseek-v4-pro",
  },
  {
    alias: "mimo-v2.5",
    provider: "commandcode",
    model: "xiaomi/mimo-v2.5",
  },
];

/**
 * Seed defaults when the registry is empty. Candidates are filtered to providers
 * the app knows about and that do not collide with built-in @mentions.
 */
export function seedModelAliasesIfEmpty(
  aliases: readonly ModelAlias[],
  availableProviders?: readonly string[],
): ModelAlias[] {
  if (aliases.length > 0) return [...aliases];
  const allowed = new Set(
    availableProviders && availableProviders.length > 0
      ? availableProviders
      : SEEDABLE_MODEL_ALIAS_PROVIDERS,
  );
  const seeded: ModelAlias[] = [];
  for (const candidate of SEED_MODEL_ALIAS_CANDIDATES) {
    if (!allowed.has(candidate.provider)) continue;
    if (isReservedModelAlias(candidate.alias)) continue;
    if (validateModelAlias(candidate.alias, seeded) !== null) continue;
    seeded.push(candidate);
  }
  return seeded;
}

export function normalizeModelAliases(value: unknown): ModelAlias[] {
  const parsed = z.array(modelAliasSchema).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.map((entry) => ({
    alias: entry.alias.trim(),
    provider: entry.provider.trim(),
    model: entry.model.trim(),
    ...(entry.effort ? { effort: entry.effort.trim() } : {}),
  }));
}
