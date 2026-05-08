import { describe, expect, it } from "vitest";
import { buildPromptContentBlocks } from "./promptContent";

describe("buildPromptContentBlocks", () => {
  it("keeps text-only prompts as a text block", () => {
    expect(buildPromptContentBlocks("hello")).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("preserves file mentions separately from attachment chips", () => {
    expect(
      buildPromptContentBlocks("check src/app.ts", [
        { kind: "text", content: "check " },
        { kind: "file", path: "src/app.ts" },
        { kind: "attachment", path: "C:\\tmp\\notes.pdf", mimeType: "application/pdf" },
      ]),
    ).toEqual([
      { kind: "text", text: "check " },
      { kind: "file", path: "src/app.ts", name: "app.ts", source: "mention" },
      {
        kind: "file",
        path: "C:\\tmp\\notes.pdf",
        name: "notes.pdf",
        source: "attachment",
      },
    ]);
  });

  it("maps image attachments to local image content blocks", () => {
    expect(
      buildPromptContentBlocks("", [
        { kind: "attachment", path: "C:\\tmp\\shot.png", mimeType: "image/png" },
      ]),
    ).toEqual([
      {
        kind: "image",
        mimeType: "image/png",
        dataUrl: "lightcode-local:///C:/tmp/shot.png",
        path: "C:\\tmp\\shot.png",
        name: "shot.png",
        source: "attachment",
      },
    ]);
  });
});
