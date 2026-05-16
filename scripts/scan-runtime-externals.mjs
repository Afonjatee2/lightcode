#!/usr/bin/env node
// Prints the list of npm packages that the production-built supervisor/main/
// preload bundles still require() at runtime (i.e. tsdown did not inline).
// These are the only packages the stage build needs to install.
//
// Usage: pnpm run build && node scripts/scan-runtime-externals.mjs

import { readFileSync, existsSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = ["main.cjs", "supervisor.cjs", "preload.cjs"]
  .map((name) => resolve(repoRoot, "dist/main", name))
  .filter((p) => existsSync(p));

if (files.length === 0) {
  console.error("No bundled output found. Run `pnpm run build` first.");
  process.exit(1);
}

const code = files.map((p) => readFileSync(p, "utf8")).join("\n");

const requireIds = [...code.matchAll(/require\(["'`]([^"'`]+)["'`]\)/g)].map((m) => m[1]);
const dynamicImportIds = [...code.matchAll(/import\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(
  (m) => m[1],
);

const externals = new Set();
for (const id of [...requireIds, ...dynamicImportIds]) {
  if (id.startsWith(".")) continue;
  if (id.startsWith("/")) continue;
  if (isBuiltin(id)) continue;
  const parts = id.split("/");
  const pkg = id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (isBuiltin(pkg)) continue;
  externals.add(pkg);
}

for (const pkg of [...externals].sort()) {
  console.log(pkg);
}
