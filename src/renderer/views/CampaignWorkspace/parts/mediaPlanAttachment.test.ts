import { describe, expect, it } from "vitest";
import {
  extractAttachmentPathsFromMessage,
  isMediaPlanFilename,
  mediaPlanAttachmentsFromMessage,
} from "./mediaPlanAttachment";

describe("mediaPlanAttachment", () => {
  it("detects media plan filenames by extension", () => {
    expect(isMediaPlanFilename("plan.xlsx")).toBe(true);
    expect(isMediaPlanFilename("plan.xlsm")).toBe(true);
    expect(isMediaPlanFilename("plan.csv")).toBe(true);
    expect(isMediaPlanFilename("notes.txt")).toBe(false);
  });

  it("extracts media plan attachments from consultation messages", () => {
    const message =
      "Please review\n\nAttached files: ./attachments/plan-v3.xlsx ./attachments/brief.pdf";
    expect(mediaPlanAttachmentsFromMessage(message)).toEqual([
      { path: "./attachments/plan-v3.xlsx", fileName: "plan-v3.xlsx" },
    ]);
    expect(extractAttachmentPathsFromMessage(message)).toHaveLength(2);
  });
});
