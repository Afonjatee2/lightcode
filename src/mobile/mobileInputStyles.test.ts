import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile iOS input ergonomics", () => {
  it("applies the 16px no-zoom floor to every document-level editable control", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toContain(
      'html[data-mobile-platform="ios"] :is(input, textarea, select, [contenteditable="true"])',
    );
    expect(css).toMatch(
      /html\[data-mobile-platform="ios"\] :is\(input, textarea, select, \[contenteditable="true"\]\)\s*\{\s*font-size: 16px;/,
    );
  });
});
