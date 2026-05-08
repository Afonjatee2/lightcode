import { describe, expect, it } from "vitest";
import { parseProjectPathRef } from "./parseProjectPathRef";

describe("parseProjectPathRef", () => {
  it("recognizes a file path with extension", () => {
    expect(parseProjectPathRef("src/foo/bar.ts")).toEqual({
      kind: "file",
      path: "src/foo/bar.ts",
    });
  });

  it("recognizes a file path with line suffix", () => {
    expect(parseProjectPathRef("src/foo/bar.ts:42")).toEqual({
      kind: "file",
      path: "src/foo/bar.ts",
      line: 42,
    });
  });

  it("recognizes a folder path with trailing separator", () => {
    expect(parseProjectPathRef("src/foo/")).toEqual({ kind: "folder", path: "src/foo" });
  });

  it("recognizes a folder path with no extension", () => {
    expect(parseProjectPathRef("src/foo/bar")).toEqual({ kind: "folder", path: "src/foo/bar" });
  });

  it("rejects whitespace, urls, and bare words", () => {
    expect(parseProjectPathRef("not a path")).toBeNull();
    expect(parseProjectPathRef("https://example.com/foo")).toBeNull();
    expect(parseProjectPathRef("hello")).toBeNull();
  });

  describe("with rootNames validation", () => {
    const rootNames = new Set(["src", "package.json", "scripts"]);

    it("accepts a path whose first segment is a known root", () => {
      expect(parseProjectPathRef("src/foo/bar.ts", { rootNames })).toEqual({
        kind: "file",
        path: "src/foo/bar.ts",
      });
    });

    it("rejects a path whose first segment is unknown (npm scoped pkg)", () => {
      expect(parseProjectPathRef("@tanstack/react-virtual", { rootNames })).toBeNull();
      expect(parseProjectPathRef("@heroui/react", { rootNames })).toBeNull();
    });

    it("rejects a slashed token whose first segment is just unknown", () => {
      expect(parseProjectPathRef("foo/bar.ts", { rootNames })).toBeNull();
    });

    it("does not enforce root-name check for tokens without a separator", () => {
      // Single-segment tokens with an extension can still be recognized; the
      // root-name guard only applies when a directory separator is present.
      expect(parseProjectPathRef("README.md", { rootNames })).toEqual({
        kind: "file",
        path: "README.md",
      });
    });
  });
});
