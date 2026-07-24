import { createHash } from "node:crypto";

/**
 * Deterministic content hash (sha256 over canonical JSON). Used to detect
 * unchanged context packets / thread summaries so we never persist a duplicate.
 */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/** JSON.stringify with sorted object keys so key order never changes the hash. */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}
