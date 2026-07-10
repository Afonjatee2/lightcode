import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentRegistry } from "./registry";

const EXPECTED_BUILT_IN_ORDER = [
  "claude",
  "copilot",
  "codex",
  "gemini",
  "grok",
  "antigravity",
  "commandcode",
  "cursor",
  "opencode",
] as const;

function detectionProviderKinds(): string[] {
  return readdirSync(import.meta.dirname, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(import.meta.dirname, entry.name, "detection.ts")),
    )
    .map((entry) => entry.name)
    .sort();
}

describe("built-in agent registry", () => {
  const adapters = createAgentRegistry();
  const kinds = adapters.map((adapter) => adapter.kind);

  it("preserves the intentional provider order", () => {
    expect(kinds).toEqual(EXPECTED_BUILT_IN_ORDER);
  });

  it("covers every provider directory with a detection spec", () => {
    expect([...kinds].sort()).toEqual(detectionProviderKinds());
  });

  it("registers every kind exactly once", () => {
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it.each(adapters.map((adapter) => [adapter.kind, adapter] as const))(
    "exposes nonempty identity metadata for %s",
    (_kind, adapter) => {
      expect(adapter.label.trim().length).toBeGreaterThan(0);
      expect(adapter.binary?.trim().length).toBeGreaterThan(0);
    },
  );
});
