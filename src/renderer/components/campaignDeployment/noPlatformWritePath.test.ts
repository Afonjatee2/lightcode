import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function moduleFiles(): string[] {
  return readdirSync(here, { recursive: true })
    .map((entry) => entry.toString())
    .filter(
      (file) =>
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx"),
    );
}

/**
 * Architectural guard: the approval docket is a pure presentation layer over
 * an injected callback surface. It must not open any network or platform
 * channel itself — every mutation flows through `ActionProposalCallbacks`,
 * which the host implements. NON-PRODUCTION guard test: static source scan
 * only, no fixtures, no live services.
 */
describe("campaignDeployment has no direct platform-write path", () => {
  const FORBIDDEN = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\baxios\b/i,
    /new\s+Request\s*\(/,
    /\bnavigator\.sendBeacon\b/,
    /https?:\/\/(?!schema\.org)/i,
    /\bimport\s*\(\s*["']node:https?["']\s*\)/,
    /\brequire\s*\(\s*["'](https?|node:https?)["']\s*\)/,
  ];

  it("contains no network primitives or hardcoded endpoints in module sources", () => {
    const files = moduleFiles();
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(here, file), "utf8");
      source.split("\n").forEach((line, index) => {
        for (const pattern of FORBIDDEN) {
          if (pattern.test(line)) {
            violations.push(`${file}:${index + 1} matches ${pattern}`);
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("routes every decision exclusively through the injected callbacks type", () => {
    const docketSource = readFileSync(join(here, "ApprovalDocket.tsx"), "utf8");
    expect(docketSource).toContain("callbacks.onApprove");
    expect(docketSource).toContain("callbacks.onReject");
    expect(docketSource).toContain("callbacks.onRefresh");
    expect(docketSource).not.toMatch(/\blocalStorage\b/);
    expect(docketSource).not.toMatch(/\bindexedDB\b/i);
    expect(docketSource).not.toMatch(/\bsqlite\b/i);
  });
});
