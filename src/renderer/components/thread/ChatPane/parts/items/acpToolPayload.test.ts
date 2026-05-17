import { describe, expect, it } from "vitest";
import {
  extractAcpAddedFileText,
  extractAcpDiffResultPart,
  extractAcpDiffSummary,
  extractAcpPatchTargetPath,
  extractAcpResultPart,
} from "./acpToolPayload";

const FILE_DIFF = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

describe("acpToolPayload", () => {
  it("marks unified diff results as diff output", () => {
    const payload = { result: { detailedContent: FILE_DIFF } };

    expect(extractAcpResultPart(payload)).toEqual({ text: FILE_DIFF, language: "diff" });
    expect(extractAcpDiffResultPart(payload)).toEqual({ text: FILE_DIFF, language: "diff" });
  });

  it("keeps non-diff results out of the diff-only file-change body", () => {
    expect(extractAcpDiffResultPart({ result: { content: "done" } })).toEqual({
      text: "",
      language: "plain",
    });
  });

  it("synthesizes a unified diff from replacement-style edit args", () => {
    expect(
      extractAcpDiffResultPart({
        path: "src/foo.ts",
        args: { filePath: "src/foo.ts", oldString: "old\nvalue", newString: "new\nvalue" },
        result: { content: "Edit applied successfully." },
      }),
    ).toEqual({
      text: [
        "diff --git a/src/foo.ts b/src/foo.ts",
        "--- a/src/foo.ts",
        "+++ b/src/foo.ts",
        "@@ -1,2 +1,2 @@",
        "-old",
        "-value",
        "+new",
        "+value",
        "",
      ].join("\n"),
      language: "diff",
    });
  });

  it("synthesizes insertion diffs from snake_case edit args", () => {
    const part = extractAcpDiffResultPart({
      path: "src/foo.ts",
      args: { file_path: "src/foo.ts", old_string: "", new_string: "added\nline" },
    });

    expect(part.language).toBe("diff");
    expect(part.text).toContain("@@ -0,0 +1,2 @@");
    expect(part.text).toContain("+added");
    expect(part.text).toContain("+line");
  });

  it("reconstructs apply_patch add-file content for absolute plan paths", () => {
    const planPath =
      "/Users/serhiivecherenko/.copilot/session-state/d8992383-f6b2-4ee2-a017-d59315f53dc1/plan.md";
    const payload = {
      args: [
        "*** Begin Patch",
        `*** Add File: ${planPath}`,
        "+Problem:",
        "+- show plan previews for apply_patch creates",
        "+",
        "+Approach:",
        "+- render add-file contents from patch args",
        "*** End Patch",
      ].join("\n"),
    };

    expect(extractAcpAddedFileText(payload, planPath)).toBe(
      [
        "Problem:",
        "- show plan previews for apply_patch creates",
        "",
        "Approach:",
        "- render add-file contents from patch args",
        "",
      ].join("\n"),
    );
  });

  it("synthesizes diffs and summaries from apply_patch patchText args", () => {
    const payload = {
      args: {
        patchText: [
          "*** Begin Patch",
          "*** Update File: src/foo.ts",
          "@@",
          "-old",
          "+new",
          "*** End Patch",
        ].join("\n"),
      },
    };

    expect(extractAcpPatchTargetPath(payload)).toBe("src/foo.ts");
    expect(extractAcpDiffSummary(payload)).toEqual({ added: 1, removed: 1 });
    expect(extractAcpDiffResultPart(payload)).toEqual({
      text: [
        "diff --git a/src/foo.ts b/src/foo.ts",
        "--- a/src/foo.ts",
        "+++ b/src/foo.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
      language: "diff",
    });
  });
});
