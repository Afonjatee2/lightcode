import { readFileSync, readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { resolve } from "node:path";
import { tokenizer } from "acorn";

// Electron exposes this module from the host runtime; it must not be installed
// into the packaged app's node_modules tree.
const HOST_PROVIDED_PACKAGES = new Set(["electron"]);

function packageNameFor(id) {
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Find literal require()/import() module IDs without matching examples embedded
 * in comments or template strings. The previous regex scanner mistook the JXA
 * source text `ObjC.import("stdlib")` for a JavaScript dynamic import.
 */
export function scanModuleIds(code) {
  const ids = new Set();
  const tokens = tokenizer(code, {
    allowHashBang: true,
    ecmaVersion: "latest",
    sourceType: "module",
  });
  let current = tokens.getToken();
  let openParen = tokens.getToken();
  let specifier = tokens.getToken();

  while (current.type.label !== "eof") {
    const isRequire = current.type.label === "name" && current.value === "require";
    const isImport = current.type.label === "import";
    if (
      (isRequire || isImport) &&
      openParen.type.label === "(" &&
      specifier.type.label === "string"
    ) {
      ids.add(specifier.value);
    }
    current = openParen;
    openParen = specifier;
    specifier = tokens.getToken();
  }

  return [...ids];
}

export function scanRuntimeExternals(repoRoot) {
  const outputDir = resolve(repoRoot, "dist/main");
  const files = readdirSync(outputDir)
    .filter((name) => name.endsWith(".cjs") || name.endsWith(".mjs"))
    .map((name) => resolve(outputDir, name));

  if (files.length === 0) {
    throw new Error("No bundled output found. Run `pnpm run build` first.");
  }

  const externals = new Set();
  for (const path of files) {
    for (const id of scanModuleIds(readFileSync(path, "utf8"))) {
      if (id.startsWith(".") || id.startsWith("/") || isBuiltin(id)) continue;
      const packageName = packageNameFor(id);
      if (!packageName || isBuiltin(packageName) || HOST_PROVIDED_PACKAGES.has(packageName)) {
        continue;
      }
      externals.add(packageName);
    }
  }

  return [...externals].sort();
}
