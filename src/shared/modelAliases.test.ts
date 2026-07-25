import { describe, expect, it } from "vitest";
import {
  buildModelAliasLookup,
  isReservedModelAlias,
  normalizeModelAliasToken,
  seedModelAliasesIfEmpty,
  validateModelAlias,
} from "./modelAliases";
import type { ModelAlias } from "./modelAliases";

describe("model alias registry", () => {
  const sample: ModelAlias[] = [
    { alias: "gpt-5.6-sol-high", provider: "codex", model: "gpt-5.6-sol", effort: "high" },
  ];

  it("normalizes alias tokens case-insensitively", () => {
    expect(normalizeModelAliasToken("GPT-5.6-SOL-HIGH")).toBe("gpt-5.6-sol-high");
  });

  it("rejects reserved built-in mentions", () => {
    expect(isReservedModelAlias("codex")).toBe(true);
    expect(validateModelAlias("codex", [])).toEqual({
      code: "reserved_alias",
      alias: "codex",
    });
  });

  it("rejects duplicate aliases", () => {
    expect(validateModelAlias("gpt-5.6-sol-high", sample)).toEqual({
      code: "duplicate_alias",
      alias: "gpt-5.6-sol-high",
    });
  });

  it("builds a case-insensitive lookup map", () => {
    const lookup = buildModelAliasLookup(sample);
    expect(lookup.get("gpt-5.6-sol-high")?.provider).toBe("codex");
  });

  it("seeds defaults only when the registry is empty", () => {
    const seeded = seedModelAliasesIfEmpty([]);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.some((entry) => entry.alias === "gpt-5.6-sol-high")).toBe(true);
    expect(seedModelAliasesIfEmpty(seeded)).toEqual(seeded);
  });

  it("filters seeds to available providers when provided", () => {
    const seeded = seedModelAliasesIfEmpty([], ["codex"]);
    expect(seeded.every((entry) => entry.provider === "codex")).toBe(true);
  });
});

describe("model alias seeding through shared settings", () => {
  it("seeds defaults when the field is absent, but preserves an explicit empty array", async () => {
    const { normalizeSharedSettings } = await import("./settings");
    // Fresh install / older settings file: no modelAliases key at all → seeded.
    expect(normalizeSharedSettings({}).modelAliases.length).toBeGreaterThan(0);
    // User deleted every alias: explicit [] must NOT resurrect the defaults.
    expect(normalizeSharedSettings({ modelAliases: [] }).modelAliases).toEqual([]);
  });
});
