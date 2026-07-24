import { describe, expect, it } from "vitest";
import { scanModuleIds } from "../../scripts/runtime-externals.mjs";

describe("scanModuleIds", () => {
  it("finds CommonJS, dynamic, static, and minified-template module specifiers", () => {
    const code = `
      const commonJs = require("common-js/subpath");
      const dynamic = import("@scope/dynamic");
      const minifiedDynamic = import(\`minified-dynamic/subpath\`);
      import { value } from "static-import";
      import "side-effect-import";
      export { value } from "export-from";
      export * from "@scope/export-star";
    `;

    expect(scanModuleIds(code)).toEqual([
      "common-js/subpath",
      "@scope/dynamic",
      "minified-dynamic/subpath",
      "static-import",
      "side-effect-import",
      "export-from",
      "@scope/export-star",
    ]);
  });

  it("ignores method calls, source text, and interpolated templates", () => {
    const code = `
      ObjC.import("stdlib");
      loader.require("loader-only");
      const sourceExample = 'require("example-only")';
      const templateExample = \`import("also-example-only")\`;
      const dynamicName = import(\`package/\${suffix}\`);
    `;

    expect(scanModuleIds(code)).toEqual([]);
  });
});
